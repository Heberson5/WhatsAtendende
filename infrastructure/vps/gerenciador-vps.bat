@echo off
color 0A
title GERENCIADOR DA VPS - ORACLE CLOUD

rem =====================================================================
rem Edite estas linhas para o seu ambiente antes de usar.
rem =====================================================================
set IP=147.15.110.106
set USER=ubuntu
set KEY=C:\Users\Heberson\Downloads\ssh-key-2026-08-01.key
set PROJETO=~/whatsatendende
set REPO_WHATSATENDENDE=https://github.com/Heberson5/WhatsAtendende.git
rem Endereco publico HTTPS real do sistema (o que aparece na barra do
rem navegador) - usado so no PRIMEIRO deploy, para gerar o .env da VPS
rem com WEB_APP_URL correto (cookie de sessao "Secure", CORS e os links
rem enviados por e-mail dependem disso comecar com "https://").
set DOMINIO=https://atendimento.sauberlich.com.br
rem Branch que a VPS deve seguir. As opcoes [1] e [15] agora fixam a VPS
rem NESTA branch a cada atualizacao (git fetch + reset --hard), entao um
rem "git pull" antigo apontando para outra branch nunca mais fica pra tras
rem em silencio. Troque para "main" quando essas correcoes forem
rem mescladas na branch principal do projeto.
set BRANCH=claude/whatsapp-multiuser-support-web-02oo3i
set PROJETO2=~/treinamentos
set ENVTREINO=C:\Users\Heberson\Documents\GitHub\treinamentos\.env

:MENU
cls
echo ============================================================
echo              GERENCIADOR DA VPS ORACLE CLOUD
echo ============================================================
echo.
echo Servidor : %IP%
echo Projeto  : WhatsAtendende
echo.
echo ============================================================
echo.
echo   [1] Atualizar Sistema (Git Pull + Docker Build)
echo   [2] Conectar via SSH
echo   [3] Ver Containers
echo   [4] Reiniciar Sistema
echo   [5] Ver Logs
echo   [6] Status do Docker
echo   [7] Uso de CPU / RAM / Disco
echo   [8] Atualizar Ubuntu
echo   [9] Reiniciar VPS
echo  [10] Abrir Sistema no Navegador
echo  [11] Docker Compose Down
echo  [12] Docker Compose Up
echo  [13] Instalar Docker e Docker Compose
echo  [14] Preparar VPS para Aplicacao
echo  [15] Deploy/Atualizar WhatsAtendende
echo  [16] Deploy/Atualizar Treinamentos
echo  [17] Abrir Treinamentos no Navegador
echo  [18] Criar Swap (4GB) - Corrige falta de memoria
echo  [19] Ver docker-compose.yml do WhatsAtendende
echo  [20] Ver .env/commit/bundle do Treinamentos
echo  [21] Popular usuarios iniciais do WhatsAtendende (seed)
echo  [22] Remover Chamados do VPS (containers + pasta)
echo  [23] Ver versao (commit) do WhatsAtendende em producao
echo  [24] Backup Completo do WhatsAtendende (antes de atualizar)
echo  [25] Listar Backups do WhatsAtendende
echo  [26] Restaurar um Backup do WhatsAtendende
echo.
echo   [0] Sair
echo.
set /p op=Escolha uma opcao:

if "%op%"=="1" goto UPDATE
if "%op%"=="2" goto SSH
if "%op%"=="3" goto PS
if "%op%"=="4" goto RESTART
if "%op%"=="5" goto LOGS
if "%op%"=="6" goto STATUS
if "%op%"=="7" goto MONITOR
if "%op%"=="8" goto UPGRADE
if "%op%"=="9" goto REBOOT
if "%op%"=="10" goto SITE
if "%op%"=="11" goto DOWN
if "%op%"=="12" goto UP
if "%op%"=="13" goto INSTALL_DOCKER
if "%op%"=="14" goto PREPARE
if "%op%"=="15" goto DEPLOY_WHATSATENDENDE
if "%op%"=="16" goto DEPLOY_TREINAMENTOS
if "%op%"=="17" goto SITE_TREINO
if "%op%"=="18" goto SWAP
if "%op%"=="19" goto CATCOMPOSE
if "%op%"=="20" goto CATENV
if "%op%"=="21" goto SEED_WHATSATENDENDE
if "%op%"=="22" goto REMOVE_CHAMADOS
if "%op%"=="23" goto VERSAO_WHATSATENDENDE
if "%op%"=="24" goto BACKUP_WHATSATENDENDE
if "%op%"=="25" goto LIST_BACKUPS
if "%op%"=="26" goto RESTORE_BACKUP
if "%op%"=="0" exit

goto MENU

:UPDATE
cls
echo Atualizando projeto (git fetch + reset --hard + rebuild completo)...
call :HARD_UPDATE_WHATSATENDENDE
pause
goto MENU

rem =====================================================================
rem Rotina compartilhada por [1] e [15] - garante que toda atualizacao
rem realmente aplica o codigo mais novo, sem depender de cache antigo.
rem Dividida em chamadas SSH separadas, cada uma com sua propria
rem checagem de sucesso/falha (%ERRORLEVEL%), em vez de um unico comando
rem gigante onde uma falha no meio passava batido no meio da rolagem de
rem texto:
rem   [1/4] git fetch + reset --hard na branch %BRANCH% (nunca fica preso
rem         numa branch antiga, nem trava por alteracao local na VPS) -
rem         mostra o commit antes/depois, pra confirmar visualmente que
rem         pegou a versao nova
rem   [2/4] confere/corrige o WEB_APP_URL no .env
rem   [3/4] docker compose down - ESSENCIAL nesta VPS pequena (<1GB RAM):
rem         builda-lo com os containers antigos (Postgres/Redis/API/Web)
rem         ainda rodando disputava a pouca RAM livre com o processo de
rem         build do frontend (Vite/esbuild), que passou a falhar (ou
rem         ficar lento demais por estar trocando com o swap) assim que o
rem         bundle cresceu um pouco (graficos 3D + exportacao PPT) - o
rem         "docker compose build" terminava sem erro nenhum reportado,
rem         mas por causa do "&&" o "docker compose up" seguinte nunca
rem         chegava a rodar, entao os containers ANTIGOS continuavam no
rem         ar, servindo o bundle antigo pra sempre, com o deploy inteiro
rem         parecendo ter funcionado. Ver PROMPT: "subi a atualizacao,
rem         mas nao apareceu as melhorias".
rem   [4/4] docker compose build (reconstroi as imagens com o codigo
rem         novo, agora com RAM livre) + up -d --remove-orphans (sobe os
rem         containers novos) + docker image prune (limpa imagens
rem         antigas, evita lotar o disco) + docker compose ps no final
rem A migracao do banco (prisma migrate deploy) roda sozinha, dentro do
rem container, antes do servidor da API iniciar - nao precisa fazer nada
rem a parte para isso.
rem
rem Efeito colateral aceito: o sistema fica FORA DO AR durante o passo
rem [4/4] (o tempo do build, alguns minutos) - antes o
rem "--force-recreate" dava a impressao de zero downtime, mas na pratica
rem o deploy so aparentava funcionar sem nunca aplicar o codigo novo, o
rem que e bem pior. Se o build do passo [4/4] falhar, os containers ja
rem estarao parados (o "docker compose down" do passo [3/4] ja rodou) -
rem para voltar ao ar com a ultima imagem que build com sucesso enquanto
rem investiga o erro, rode a opcao [12] Docker Compose Up.
rem =====================================================================
:HARD_UPDATE_WHATSATENDENDE
echo.
echo [1/4] Sincronizando codigo (branch %BRANCH%)...
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && echo === Commit ANTES da atualizacao === && git log -1 --oneline && git fetch origin && git checkout %BRANCH% && git reset --hard origin/%BRANCH% && echo === Commit DEPOIS da atualizacao === && git log -1 --oneline"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao sincronizar o codigo via git. Os containers NAO
    echo foram reconstruidos - nada mudou no servidor. Confira a mensagem
    echo de erro acima ^(ex.: sem conexao com o GitHub, chave SSH^).
    exit /b 1
)
echo.
rem Corrige em todo deploy (nao so no primeiro) um .env que ainda tenha
rem ficado com o WEB_APP_URL antigo (http://IP:8080, de antes do dominio
rem HTTPS existir) - sem isso o cookie de sessao nunca fica "Secure", o
rem CORS pode rejeitar o dominio real, e os links/logo dos e-mails
rem automaticos apontam para um endereco que ninguem de fora consegue abrir.
echo [2/4] Conferindo WEB_APP_URL no .env da VPS...
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && if [ -f .env ]; then if grep -q '^WEB_APP_URL=' .env; then if grep -qx 'WEB_APP_URL=%DOMINIO%' .env; then echo 'WEB_APP_URL ja esta correto.'; else sed -i 's#^WEB_APP_URL=.*#WEB_APP_URL=%DOMINIO%#' .env; echo 'WEB_APP_URL corrigido para %DOMINIO%.'; fi; else echo 'WEB_APP_URL=%DOMINIO%' >> .env; echo 'WEB_APP_URL adicionado ao .env (nao existia).'; fi; fi"
echo.
echo [3/4] Parando os containers atuais para liberar RAM para o build...
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose down"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao parar os containers atuais. O build NAO foi
    echo iniciado - o sistema continua no ar com a versao anterior.
    exit /b 1
)
echo.
echo [4/4] Reconstruindo e subindo os containers ^(pode demorar alguns minutos - o sistema fica FORA DO AR ate este passo terminar^)...
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose build && docker compose up -d --remove-orphans && docker image prune -f && echo === Containers - confira se o STATUS mostra Up ha poucos segundos === && docker compose ps"
if errorlevel 1 (
    echo.
    echo [ERRO] O codigo foi atualizado, mas a reconstrucao dos containers
    echo FALHOU no meio do processo - o sistema esta FORA DO AR agora
    echo ^(o passo anterior ja tinha parado os containers antigos^). Rode a
    echo opcao [12] Docker Compose Up para voltar ao ar com a ultima
    echo imagem que build com sucesso enquanto investiga. Rode a opcao [5]
    echo para ver os logs completos do erro, e a opcao [7] para checar
    echo memoria/disco.
    exit /b 1
)
echo.
echo [OK] Codigo atualizado e containers reconstruidos com sucesso.
exit /b 0

:SSH
cls
ssh -i "%KEY%" %USER%@%IP%
goto MENU

:PS
cls
ssh -i "%KEY%" %USER%@%IP% "docker ps -a"
pause
goto MENU

:RESTART
cls
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose restart"
pause
goto MENU

:LOGS
cls
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose logs --tail=100"
pause
goto MENU

:STATUS
cls
ssh -i "%KEY%" %USER%@%IP% "sudo systemctl status docker --no-pager"
pause
goto MENU

:MONITOR
cls
ssh -i "%KEY%" %USER%@%IP% "echo ===== CPU ===== && top -bn1 | head -5 && echo. && echo ===== MEMORIA ===== && free -h && echo. && echo ===== DISCO ===== && df -h"
pause
goto MENU

:UPGRADE
cls
ssh -i "%KEY%" %USER%@%IP% "sudo apt update && sudo apt upgrade -y"
pause
goto MENU

:REBOOT
cls
echo.
set /p resp=Tem certeza que deseja reiniciar a VPS? (S/N):
if /I "%resp%"=="S" (
    ssh -i "%KEY%" %USER%@%IP% "sudo reboot"
)
pause
goto MENU

:SITE
start %DOMINIO%
goto MENU

:DOWN
cls
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose down"
pause
goto MENU

:UP
cls
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose up -d"
pause
goto MENU

:INSTALL_DOCKER
cls
echo =====================================================
echo Instalando Docker...
echo =====================================================

ssh -i "%KEY%" %USER%@%IP% "sudo apt update && sudo apt install -y apt-transport-https ca-certificates curl software-properties-common git unzip && curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker %USER% && sudo systemctl enable docker && sudo systemctl start docker && docker --version && docker compose version"

echo.
echo Docker instalado com sucesso.
echo.
pause
goto MENU

:PREPARE
cls
echo =====================================================
echo Preparando VPS...
echo =====================================================

ssh -i "%KEY%" %USER%@%IP% "sudo apt update && sudo apt upgrade -y && sudo apt install -y git curl unzip wget htop nano jq build-essential net-tools ufw && sudo timedatectl set-timezone America/Cuiaba && mkdir -p %PROJETO% && sudo systemctl restart docker && docker info"

echo.
echo VPS preparada.
echo.
pause
goto MENU

:DEPLOY_WHATSATENDENDE
cls
echo ===================================================
echo Deploy/Atualizar WhatsAtendende...
echo ===================================================
echo.
echo OBS: o Dockerfile da API roda "prisma migrate deploy"
echo automaticamente antes de subir - nao precisa rodar migration
echo a parte.
echo.
echo Se for o PRIMEIRO deploy, um .env com segredos aleatorios
echo (JWT) sera criado direto na VPS, com WHATSAPP_PROVIDER=baileys
echo (conexao real). Depois do deploy, entre em Configuracoes no
echo sistema e conecte o WhatsApp (QR Code ou codigo de pareamento).
echo.

rem Primeiro deploy apenas: clona o repositorio (se ainda nao existe) e
rem cria o .env com segredos novos (se ainda nao existe). Numa atualizacao
rem normal, com o projeto ja clonado e o .env ja no lugar, este passo nao
rem faz nada alem de trocar para a branch %BRANCH% - quem realmente
rem atualiza o codigo e reconstroi tudo e a rotina HARD_UPDATE logo abaixo.
ssh -i "%KEY%" %USER%@%IP% "if [ -d %PROJETO%/.git ]; then cd %PROJETO% && git checkout %BRANCH%; else rm -rf %PROJETO% && git clone -b %BRANCH% %REPO_WHATSATENDENDE% %PROJETO%; fi && cd %PROJETO% && if [ ! -f .env ]; then echo 'Criando .env com segredos novos (primeiro deploy)...'; { echo JWT_ACCESS_SECRET=$(openssl rand -hex 32); echo JWT_REFRESH_SECRET=$(openssl rand -hex 32); echo WHATSAPP_PROVIDER=baileys; echo WEB_APP_URL=%DOMINIO%; } > .env; echo '.env criado - faca um backup deste arquivo (nao esta no git, sem ele os logins existentes param de funcionar num redeploy que o apague).'; fi"

call :HARD_UPDATE_WHATSATENDENDE
if errorlevel 1 (
    echo.
    echo Deploy interrompido - veja o erro acima antes de tentar de novo.
    pause
    goto MENU
)

echo.
echo WhatsAtendende atualizado e no ar em %DOMINIO%
echo.
echo Se ainda nao existe nenhum usuario cadastrado (primeiro deploy),
echo use a opcao [21] para criar os usuarios iniciais e depois troque
echo as senhas padrao em Usuarios.
echo.
pause
goto MENU

:SEED_WHATSATENDENDE
cls
echo ===================================================
echo Populando usuarios iniciais do WhatsAtendende...
echo ===================================================
echo.
echo Cria os usuarios de exemplo do ambiente de desenvolvimento (ver
echo apps/api/prisma/seed.ts no codigo - as senhas nao ficam na
echo documentacao). Seguro rodar mais de uma vez: nao sobrescreve a
echo senha de um usuario que ja existe.
echo.
echo Opcionalmente, informe abaixo um e-mail e senha REAIS para criar
echo (ou corrigir a senha de) um administrador de verdade, sem que essa
echo senha fique salva em nenhum arquivo. Deixe em branco para pular.
echo Evite usar os caracteres %% ^ ^& " nessa senha (o Windows trata
echo eles de forma especial). O texto digitado fica visivel na tela.
echo.
set ADMINEMAIL=
set ADMINPASS=
set FORCERESET=
set /p ADMINEMAIL=E-mail do administrador real (ou Enter para pular):
if "%ADMINEMAIL%"=="" goto SEED_RUN
set /p ADMINPASS=Senha desse administrador:
echo.
echo Se esse e-mail JA EXISTE no banco e a senha nao esta batendo (foi
echo o caso que te trouxe aqui), responda S para forcar a redefinicao.
echo Se for a primeira vez cadastrando esse e-mail, pode responder N.
set /p FORCERESET=Forcar redefinicao de senha se ja existir? (S/N):

:SEED_RUN
if "%ADMINEMAIL%"=="" (
    ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose exec -T api npm run prisma:seed"
) else if /I "%FORCERESET%"=="S" (
    ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose exec -T -e SEED_ADMIN_EMAIL=%ADMINEMAIL% -e SEED_ADMIN_PASSWORD=%ADMINPASS% -e SEED_ADMIN_FORCE_RESET=true api npm run prisma:seed"
) else (
    ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose exec -T -e SEED_ADMIN_EMAIL=%ADMINEMAIL% -e SEED_ADMIN_PASSWORD=%ADMINPASS% api npm run prisma:seed"
)
set ADMINEMAIL=
set ADMINPASS=
set FORCERESET=

pause
goto MENU

:DEPLOY_TREINAMENTOS
cls
echo ===================================================
echo Deploy/Atualizar Treinamentos...
echo ===================================================

ssh -i "%KEY%" %USER%@%IP% "if [ -d ~/treinamentos/.git ]; then cd ~/treinamentos && git pull; else rm -rf ~/treinamentos && git clone https://github.com/Heberson5/treinamentos.git ~/treinamentos; fi"

echo Enviando .env (nao versionado no git) para a VPS...
scp -i "%KEY%" "%ENVTREINO%" %USER%@%IP%:~/treinamentos/.env

ssh -i "%KEY%" %USER%@%IP% "cd ~/treinamentos && echo RlJPTSBub2RlOjIwLXNsaW0gQVMgYnVpbGQKV09SS0RJUiAvYXBwCkNPUFkgcGFja2FnZSouanNvbiAuLwpSVU4gbnBtIGluc3RhbGwKQ09QWSAuIC4KRU5WIE5PREVfT1BUSU9OUz0tLW1heC1vbGQtc3BhY2Utc2l6ZT0xNTM2ClJVTiBucG0gcnVuIGJ1aWxkCgpGUk9NIG5naW54OnN0YWJsZS1hbHBpbmUKQ09QWSAtLWZyb209YnVpbGQgL2FwcC9kaXN0IC91c3Ivc2hhcmUvbmdpbngvaHRtbApDT1BZIG5naW54LmNvbmYgL2V0Yy9uZ2lueC9jb25mLmQvZGVmYXVsdC5jb25mCkVYUE9TRSA4MApDTUQgWyJuZ2lueCIsICItZyIsICJkYWVtb24gb2ZmOyJdCg== | base64 -d > Dockerfile && echo c2VydmVyIHsKICAgIGxpc3RlbiA4MDsKICAgIHNlcnZlcl9uYW1lIF87CiAgICByb290IC91c3Ivc2hhcmUvbmdpbngvaHRtbDsKICAgIGluZGV4IGluZGV4Lmh0bWw7CiAgICBsb2NhdGlvbiAvIHsKICAgICAgICB0cnlfZmlsZXMgJHVyaSAkdXJpLyAvaW5kZXguaHRtbDsKICAgIH0KfQo= | base64 -d > nginx.conf && echo c2VydmljZXM6CiAgdHJlaW5hbWVudG9zOgogICAgYnVpbGQ6IC4KICAgIGNvbnRhaW5lcl9uYW1lOiB0cmVpbmFtZW50b3MKICAgIHJlc3RhcnQ6IHVubGVzcy1zdG9wcGVkCiAgICBwb3J0czoKICAgICAgLSAiODA4MTo4MCIK | base64 -d > docker-compose.yml && docker compose up -d --build"

echo.
echo Treinamentos atualizado e no ar em http://%IP%:8081
echo.
pause
goto MENU

:SITE_TREINO
start http://%IP%:8081
goto MENU

:SWAP
cls
echo Criando swap de 4GB para evitar falta de memoria...
ssh -i "%KEY%" %USER%@%IP% "sudo swapoff /swapfile 2>/dev/null; sudo rm -f /swapfile && sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && (grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab) && free -h"
pause
goto MENU

:CATCOMPOSE
cls
echo docker-compose.yml atual do WhatsAtendende:
ssh -i "%KEY%" %USER%@%IP% "cat %PROJETO%/docker-compose.yml"
pause
goto MENU

:CATENV
cls
echo Verificando .env, commit e bundle do Treinamentos...
ssh -i "%KEY%" %USER%@%IP% "echo ===ENV=== ; cat ~/treinamentos/.env 2>&1 ; echo ===GITLOG=== ; cd ~/treinamentos && git log -1 --oneline ; echo ===BUNDLE=== ; docker exec treinamentos grep -rl supabase.co /usr/share/nginx/html/assets/ ; echo ===FIM==="
pause
goto MENU

:VERSAO_WHATSATENDENDE
cls
echo Verificando o que esta REALMENTE rodando em producao agora...
echo (compare o commit abaixo com o commit mais recente no GitHub)
echo.
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && echo ===BRANCH=== && git branch --show-current && echo ===COMMIT=== && git log -1 --oneline && echo ===CONTAINERS=== && docker compose ps"
pause
goto MENU

rem =====================================================================
rem Backup/Restauracao completos do WhatsAtendende - usar antes de
rem qualquer atualizacao arriscada (ex.: trocar a versao do Baileys).
rem Salva tudo que e preciso pra voltar exatamente como estava: o commit
rem do codigo, o .env, um dump do banco (Postgres) e os volumes Docker
rem (sessoes do WhatsApp, uploads, apk) - numa pasta com data/hora dentro
rem de ~/backups-whatsatendende/ na propria VPS.
rem
rem Cada chamada SSH abre uma sessao nova (nao lembra variaveis de uma
rem chamada pra outra), entao o nome da pasta do backup em andamento fica
rem guardado em ~/backups-whatsatendende/.ultimo pra os passos seguintes
rem conseguirem encontra-la de novo - mesma logica de dividir em passos
rem com checagem de erro individual da rotina HARD_UPDATE_WHATSATENDENDE
rem acima.
rem
rem Os volumes sao localizados pelo rotulo que o Docker Compose ja poe
rem neles (com.docker.compose.volume=NOME), em vez de montar o nome
rem completo na mao - assim continua funcionando mesmo se o nome do
rem projeto Compose mudar.
rem =====================================================================
:BACKUP_WHATSATENDENDE
cls
echo ===================================================
echo Backup completo do WhatsAtendende
echo ===================================================
echo.
echo Salva na propria VPS, numa pasta com data/hora, o commit atual do
echo codigo, o .env, o banco de dados e os volumes Docker - sessoes do
echo WhatsApp, uploads e o apk. O sistema continua no ar durante o
echo backup, nao precisa parar nada.
echo.
echo [1/4] Salvando commit atual e .env...
ssh -i "%KEY%" %USER%@%IP% "set -e && cd %PROJETO% && TS=$(date +%%Y%%m%%d-%%H%%M%%S) && mkdir -p ~/backups-whatsatendende/$TS && echo $TS > ~/backups-whatsatendende/.ultimo && git rev-parse HEAD > ~/backups-whatsatendende/$TS/commit-hash.txt && git log -1 --oneline > ~/backups-whatsatendende/$TS/commit.txt && cp .env ~/backups-whatsatendende/$TS/.env.backup && echo Pasta do backup: $TS"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao iniciar o backup - nada foi alterado no sistema.
    pause
    goto MENU
)
echo.
echo [2/4] Salvando o banco de dados...
ssh -i "%KEY%" %USER%@%IP% "set -e && cd %PROJETO% && BKDIR=~/backups-whatsatendende/$(cat ~/backups-whatsatendende/.ultimo) && docker compose exec -T postgres pg_dump -U whatsatendende --clean --if-exists whatsatendende > $BKDIR/banco.sql && echo Banco salvo em $BKDIR/banco.sql"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao salvar o banco de dados. O commit e o .env ja
    echo foram salvos, mas o backup esta incompleto - nao confie nele pra
    echo restaurar depois. Confira a mensagem de erro acima.
    pause
    goto MENU
)
echo.
echo [3/4] Salvando os volumes - sessoes do WhatsApp, uploads, apk...
ssh -i "%KEY%" %USER%@%IP% "set -e && BKDIR=~/backups-whatsatendende/$(cat ~/backups-whatsatendende/.ultimo) && for VOL in whatsapp_sessions api_uploads app_downloads; do REALVOL=$(docker volume ls --filter label=com.docker.compose.volume=$VOL --format '{{.Name}}') && docker run --rm -v $REALVOL:/dados -v $BKDIR:/backup alpine tar czf /backup/$VOL.tar.gz -C /dados . && echo Volume $VOL salvo.; done"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao salvar um dos volumes. O backup esta incompleto -
    echo nao confie nele pra restaurar depois. Confira a mensagem de erro
    echo acima.
    pause
    goto MENU
)
echo.
echo [4/4] Backup concluido.
ssh -i "%KEY%" %USER%@%IP% "BKDIR=~/backups-whatsatendende/$(cat ~/backups-whatsatendende/.ultimo) && echo Pasta: $BKDIR && du -sh $BKDIR && ls -lh $BKDIR"
echo.
echo Guarde o nome da pasta acima (formato AAAAMMDD-HHMMSS) - a opcao [26]
echo pede esse nome pra restaurar, caso precise voltar como estava. A
echo opcao [25] tambem lista os backups salvos a qualquer momento.
echo.
pause
goto MENU

:LIST_BACKUPS
cls
echo Backups do WhatsAtendende salvos na VPS:
echo.
ssh -i "%KEY%" %USER%@%IP% "if [ -d ~/backups-whatsatendende ]; then du -sh ~/backups-whatsatendende/* 2>/dev/null | sort -r; else echo Nenhum backup encontrado ainda - use a opcao 24.; fi"
pause
goto MENU

:RESTORE_BACKUP
cls
echo ===================================================
echo Restaurar um backup do WhatsAtendende
echo ===================================================
echo.
echo ATENCAO: isso substitui o codigo, o .env, o banco de dados e os
echo volumes Docker atuais pelos dados de um backup salvo anteriormente.
echo Tudo que foi feito no sistema DEPOIS desse backup sera perdido -
echo conversas, mensagens, usuarios cadastrados, a sessao do WhatsApp
echo conectada, etc. O sistema fica FORA DO AR durante a restauracao.
echo.
echo Use a opcao [25] pra ver os nomes dos backups disponiveis.
echo.
set BKNOME=
set /p BKNOME=Digite o nome exato da pasta do backup a restaurar, ou deixe em branco pra cancelar:
if "%BKNOME%"=="" goto MENU
echo.
echo Voce esta prestes a restaurar o backup %BKNOME% e perder tudo que foi
echo feito depois dele.
set /p CONFIRMA=Digite CONFIRMAR, em maiusculas, pra prosseguir:
if not "%CONFIRMA%"=="CONFIRMAR" (
    echo Cancelado - nada foi alterado.
    pause
    goto MENU
)

echo.
echo [1/5] Conferindo se o backup existe na VPS...
ssh -i "%KEY%" %USER%@%IP% "test -d ~/backups-whatsatendende/%BKNOME% && test -f ~/backups-whatsatendende/%BKNOME%/commit-hash.txt && test -f ~/backups-whatsatendende/%BKNOME%/banco.sql && echo Backup encontrado."
if errorlevel 1 (
    echo.
    echo [ERRO] Esse backup nao foi encontrado ou esta incompleto na VPS.
    echo Confira o nome exato com a opcao [25]. Nada foi alterado.
    pause
    goto MENU
)

echo.
echo [2/5] Parando os containers...
ssh -i "%KEY%" %USER%@%IP% "cd %PROJETO% && docker compose down"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao parar os containers. Nada foi restaurado ainda.
    pause
    goto MENU
)

echo.
echo [3/5] Restaurando codigo e .env...
ssh -i "%KEY%" %USER%@%IP% "set -e && cd %PROJETO% && BKDIR=~/backups-whatsatendende/%BKNOME% && git fetch origin && git checkout $(cat $BKDIR/commit-hash.txt) && cp $BKDIR/.env.backup .env && echo Codigo restaurado no commit: && git log -1 --oneline"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao restaurar o codigo/.env. Os containers continuam
    echo parados - rode a opcao [12] pra voltar ao ar com o que estava no
    echo disco antes de tentar de novo.
    pause
    goto MENU
)

echo.
echo [4/5] Restaurando os volumes - sessoes do WhatsApp, uploads, apk...
ssh -i "%KEY%" %USER%@%IP% "set -e && BKDIR=~/backups-whatsatendende/%BKNOME% && for VOL in whatsapp_sessions api_uploads app_downloads; do REALVOL=$(docker volume ls --filter label=com.docker.compose.volume=$VOL --format '{{.Name}}') && docker run --rm -v $REALVOL:/dados -v $BKDIR:/backup alpine sh -c 'rm -rf /dados/..?* /dados/.[!.]* /dados/* 2>/dev/null; tar xzf /backup/'$VOL'.tar.gz -C /dados' && echo Volume $VOL restaurado.; done"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao restaurar um dos volumes. O sistema esta FORA DO
    echo AR e pode estar num estado misto - repita esta opcao [26] com o
    echo mesmo backup antes de tentar subir o sistema.
    pause
    goto MENU
)

echo.
echo [5/5] Restaurando o banco de dados e subindo os containers - pode demorar alguns minutos...
ssh -i "%KEY%" %USER%@%IP% "set -e && cd %PROJETO% && BKDIR=~/backups-whatsatendende/%BKNOME% && docker compose up -d postgres && until docker compose exec -T postgres pg_isready -U whatsatendende; do sleep 1; done && docker compose exec -T postgres psql -U whatsatendende -d whatsatendende < $BKDIR/banco.sql && docker compose build && docker compose up -d --remove-orphans && docker image prune -f && echo === Containers - confira se o STATUS mostra Up ha poucos segundos === && docker compose ps"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao restaurar o banco ou subir os containers. Rode a
    echo opcao [5] pra ver os logs do erro, e a opcao [12] pra tentar subir
    echo de novo com o que ja foi restaurado.
    pause
    goto MENU
)

echo.
echo [OK] Backup %BKNOME% restaurado com sucesso. Sistema no ar em %DOMINIO%
echo.
echo O codigo ficou parado exatamente nesse commit (fora da branch %BRANCH%).
echo Se mais tarde quiser voltar a acompanhar as atualizacoes normais, use
echo a opcao [1] ou [15] normalmente - ela move o codigo de volta pra
echo ultima versao da branch.
echo.
set BKNOME=
set CONFIRMA=
pause
goto MENU

:REMOVE_CHAMADOS
cls
echo.
echo Isso para os containers do Chamados e apaga a pasta ~/chamados
echo na VPS (os dados do banco em volumes Docker NAO sao apagados -
echo se quiser apaga-los de vez depois, rode "docker volume prune"
echo manualmente).
echo.
set /p resp=Tem certeza que deseja remover o Chamados da VPS? (S/N):
if /I "%resp%"=="S" (
    ssh -i "%KEY%" %USER%@%IP% "cd ~/chamados && docker compose down; cd ~ && rm -rf ~/chamados"
)
pause
goto MENU
