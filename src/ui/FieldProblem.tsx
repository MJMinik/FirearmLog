// FieldProblem — inline per-field validation errors (spec 2026-07-22).
//
// Usage pattern:
//   const [fieldError, setFieldError] = useState<SaveProblem>(null);
//   // In the field's JSX:
//   <label className={`field${fieldError?.field === 'name' ? ' invalid' : ''}`}>
//     Label <span className="field-required-marker">(required)</span>
//     <input
//       id="field-name"
//       aria-invalid={fieldError?.field === 'name' || undefined}
//       aria-describedby={fieldError?.field === 'name' ? 'err-name' : undefined}
//       ... />
//     <FieldProblem id="err-name" problem={fieldError} field="name" />
//   </label>
//
// The component is intentionally tiny — just the message paragraph. Scroll /
// focus logic lives in persistForm() inside each form, keyed by the field ref.

export type SaveProblem = { message: string; field: string; gunId?: string } | null;

export function FieldProblem({ id, problem, field }: {
  id: string;
  problem: SaveProblem;
  field: string;
}) {
  if (!problem || problem.field !== field) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {problem.message}
    </p>
  );
}
