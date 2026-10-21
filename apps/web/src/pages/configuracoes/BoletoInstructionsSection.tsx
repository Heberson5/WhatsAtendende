import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BOLETO_INSTRUCTION_LINE_MAX_LENGTH,
  BOLETO_INSTRUCTION_LINES_MAX,
  BOLETO_INSTRUCTION_TAGS,
  PERMISSION,
  fillBoletoInstructions,
  type BoletoInstructionsDTO,
} from "@whatsatendende/types";
import { api, getApiErrorMessage } from "../../lib/api";
import { useAuthStore } from "../../store/auth-store";

// The example boleto of the preview and the hints.
const EXAMPLE = { cents: 12758, contract: "C-10", document: "D-1", due: "10/11/2026" };
const EXAMPLE_VALUE = "R$ 127,58";

const toLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Instruções do boleto: multa and juros as percentages of each boleto's original value, and the printed lines. */
export function BoletoInstructionsSection() {
  const queryClient = useQueryClient();
  const canEdit = useAuthStore((s) => Boolean(s.permissions?.[PERMISSION.FONTES_DADOS_EDITAR]));
  const { data } = useQuery({ queryKey: ["boleto-instructions"], queryFn: async () => (await api.get<BoletoInstructionsDTO>("/boletos/instructions")).data });
  const [fine, setFine] = useState("");
  const [interest, setInterest] = useState("");
  const [text, setText] = useState("");
  const [textareaEl, setTextareaEl] = useState<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!data) return;
    setFine(String(data.finePercent));
    setInterest(String(data.interestMonthPercent));
    setText(data.lines.join("\n"));
  }, [data]);

  const draft: BoletoInstructionsDTO = { finePercent: Number(fine) || 0, interestMonthPercent: Number(interest) || 0, lines: toLines(text) };
  const preview = fillBoletoInstructions(draft, EXAMPLE);
  const [fineExample, dailyExample] = fillBoletoInstructions({ ...draft, lines: ["{multa}", "{juros_dia}"] }, EXAMPLE);
  const tooManyLines = draft.lines.length > BOLETO_INSTRUCTION_LINES_MAX;
  const tooLong = draft.lines.some((line) => line.length > BOLETO_INSTRUCTION_LINE_MAX_LENGTH);
  const dirty = Boolean(data) && JSON.stringify(draft) !== JSON.stringify(data);

  const saveMutation = useMutation({
    mutationFn: async () => (await api.put<BoletoInstructionsDTO>("/boletos/instructions", draft)).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(["boleto-instructions"], saved);
      toast.success("Instruções do boleto salvas.");
    },
    onError: (err) => toast.error(getApiErrorMessage(err)),
  });

  function insertTag(tag: string) {
    const start = textareaEl?.selectionStart ?? text.length;
    const end = textareaEl?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + tag + text.slice(end));
    requestAnimationFrame(() => {
      textareaEl?.focus();
      textareaEl?.setSelectionRange(start + tag.length, start + tag.length);
    });
  }

  if (!data) return null;
  return (
    <div className="border-t border-border pt-5">
      <h2 className="text-base font-semibold">Instruções do boleto</h2>
      <p className="mt-1 text-sm text-muted">
        Saem no quadro "Instruções de responsabilidade do Cedente" de todo boleto enviado. Multa e juros são calculados sobre o valor original de cada boleto.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Multa após o vencimento (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={fine}
            onChange={(e) => setFine(e.target.value)}
            disabled={!canEdit}
            className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-muted">
            {EXAMPLE_VALUE} → multa de R$ {fineExample}
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Juros de mora (% ao mês)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            disabled={!canEdit}
            className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-muted">
            Por dia = valor × % ÷ 30 · {EXAMPLE_VALUE} → R$ {dailyExample} ao dia
          </span>
        </label>
      </div>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-medium">Texto das instruções (uma linha por instrução, até {BOLETO_INSTRUCTION_LINES_MAX})</span>
        <textarea
          ref={setTextareaEl}
          rows={BOLETO_INSTRUCTION_LINES_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!canEdit}
          className="focus-ring w-full rounded-card border border-border bg-transparent px-3 py-2 text-sm"
        />
      </label>
      {tooManyLines && <p className="text-xs text-danger">No máximo {BOLETO_INSTRUCTION_LINES_MAX} linhas — é o que cabe no boleto.</p>}
      {tooLong && <p className="text-xs text-danger">Cada linha pode ter até {BOLETO_INSTRUCTION_LINE_MAX_LENGTH} caracteres.</p>}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          Clique para inserir:
          {BOLETO_INSTRUCTION_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertTag(tag)}
              className="focus-ring rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary hover:bg-primary/20"
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-card border border-dashed border-border bg-surface-alt px-3 py-2 text-xs">
        <p className="font-semibold">
          Prévia <span className="font-normal text-muted">(boleto de exemplo: {EXAMPLE_VALUE}, vencimento {EXAMPLE.due})</span>
        </p>
        {preview.map((line, i) => (
          <p key={i} className="mt-0.5">
            {line}
          </p>
        ))}
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !dirty || tooManyLines || tooLong}
          className="focus-ring mt-3 rounded-card bg-primary px-3 py-2 text-sm font-semibold text-primary-fg disabled:opacity-60"
        >
          Salvar instruções
        </button>
      )}
    </div>
  );
}
