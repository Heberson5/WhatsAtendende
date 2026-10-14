#!/usr/bin/env bash
# Diagnóstico de "Aguardando mensagem" — quando um cliente diz que não recebeu.
#
# Mostra, no período pedido, cada vez que o celular de um cliente não conseguiu
# abrir uma mensagem e pediu para recebê-la de novo: o horário, a mensagem, o
# cliente e o endereço do WhatsApp usado para ele. Com um telefone, mostra
# também o cadastro desse cliente e as últimas mensagens enviadas a ele.
#
# Uso (na pasta do projeto, na VPS):
#   bash infrastructure/vps/diagnostico-entrega.sh [horas] [telefone]
#   bash infrastructure/vps/diagnostico-entrega.sh 2
#   bash infrastructure/vps/diagnostico-entrega.sh 24 556599286623
#
# Só lê: não altera nada no sistema.
set -u

HORAS="${1:-2}"
FONE="$(printf '%s' "${2:-}" | tr -cd '0-9')"
case "$HORAS" in '' | *[!0-9]*) HORAS=2 ;; esac
FUSO="America/Cuiaba"

cd "$(dirname "$0")/../.." || exit 1

psql_q() {
  docker compose exec -T postgres psql -U whatsatendende -P pager=off -c "$1"
}

campo() { # campo <nome> <linha JSON> — o valor de um campo simples do log
  sed -n "s/.*\"$1\":\"\\{0,1\\}\\([^\",}]*\\).*/\\1/p" <<<"$2"
}

echo
echo "=== Mensagens que o celular do cliente não conseguiu abrir (últimas ${HORAS}h) ==="
echo

LINHAS="$(docker compose logs api --since "${HORAS}h" --no-log-prefix 2>&1 | grep -E "asked to resend|@lid failed")"
IDS=()
if [ -z "$LINHAS" ]; then
  echo "Nenhuma. Nenhum celular de cliente pediu reenvio neste período."
else
  while IFS= read -r linha; do
    [ -z "$linha" ] && continue
    ms="$(campo time "$linha")"
    quando="$(TZ="$FUSO" date -d "@$((ms / 1000))" '+%d/%m %H:%M:%S' 2>/dev/null || echo '?')"
    if grep -q "@lid failed" <<<"$linha"; then
      echo "$quando  o WhatsApp recusou o endereço $(campo chatId "$linha") — a mensagem foi pelo número"
    else
      id="$(campo providerMessageId "$linha")"
      if [ "$(campo resent "$linha")" = "true" ]; then situacao="reenviada"; else situacao="NÃO reenviada (o sistema não tinha mais a mensagem)"; fi
      echo "$quando  pedido de reenvio  $id  $situacao"
      IDS+=("'$id'")
    fi
  done <<<"$LINHAS"
fi

if [ "${#IDS[@]}" -gt 0 ]; then
  echo
  echo "--- Quais mensagens e de quais clientes (horário de Cuiabá) ---"
  LISTA="$(IFS=,; echo "${IDS[*]}")"
  psql_q "select to_char(m.\"createdAt\" at time zone 'UTC' at time zone '$FUSO', 'DD/MM HH24:MI:SS') as enviada,
                 coalesce(m.\"automatedBy\", 'atendente') as origem,
                 left(replace(m.body, chr(10), ' '), 45) as texto,
                 c.phone as telefone,
                 coalesce(c.\"providerChatId\", '-') as endereco
            from \"Message\" m
            join \"Conversation\" v on v.id = m.\"conversationId\"
            join \"Contact\" c on c.id = v.\"contactId\"
           where m.\"providerMessageId\" in ($LISTA)
           order by m.\"createdAt\";"
fi

if [ -n "$FONE" ]; then
  echo
  echo "=== Cliente com telefone terminado em $FONE ==="
  psql_q "select c.phone as telefone, coalesce(c.name, '-') as nome,
                 coalesce(c.\"providerChatId\", '-') as endereco,
                 case when c.\"providerChatId\" like '%@lid' then 'sim' else 'NÃO (vai pelo número)' end as usa_lid,
                 coalesce(w.name, '-') as conexao
            from \"Contact\" c
            left join \"WhatsAppConnection\" w on w.id = c.\"whatsappConnectionId\"
           where c.phone like '%$FONE';"
  echo
  echo "--- Últimas 10 mensagens enviadas a ele (horário de Cuiabá) ---"
  psql_q "select to_char(m.\"createdAt\" at time zone 'UTC' at time zone '$FUSO', 'DD/MM HH24:MI:SS') as enviada,
                 coalesce(m.\"automatedBy\", 'atendente') as origem,
                 m.status,
                 left(replace(coalesce(m.body, '(arquivo)'), chr(10), ' '), 45) as texto
            from \"Message\" m
            join \"Conversation\" v on v.id = m.\"conversationId\"
            join \"Contact\" c on c.id = v.\"contactId\"
           where c.phone like '%$FONE' and m.direction = 'OUTBOUND'
           order by m.\"createdAt\" desc
           limit 10;"
fi

echo
echo "Como ler:"
echo " - \"reenviada\": o celular pediu e o sistema reenviou. Se o cliente ainda vê \"Aguardando mensagem\""
echo "   nessa mesma mensagem, mande este resultado para o suporte."
echo " - \"usa_lid = NÃO\" num cliente que reclama: peça para ele mandar uma mensagem; o sistema passa a"
echo "   usar o endereço novo dele. Depois reenvie o que ele não recebeu."
echo " - Mensagens que ficaram em \"Aguardando mensagem\" não voltam sozinhas: reenvie as importantes."
