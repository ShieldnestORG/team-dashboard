import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Pencil, Trash2, Plus, X } from "lucide-react";
import {
  eventConstraintsApi,
  type EventConstraint,
  type EventConstraintInput,
  type EventConstraintPatch,
} from "../api/event-constraints";
import { causalEventsApi } from "../api/causal-events";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

interface FormState {
  kind: string;
  of: string;
  require: string;
  maxLagMs: number;
  enabled: boolean;
}

const emptyForm: FormState = {
  kind: "",
  of: "",
  require: "",
  maxLagMs: 60000,
  enabled: true,
};

interface ConstraintFormProps {
  initial?: FormState;
  submitting: boolean;
  onSubmit: (form: FormState) => void;
  onCancel: () => void;
  kindSuggestions: string[];
  submitLabel: string;
}

function ConstraintForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
  kindSuggestions,
  submitLabel,
}: ConstraintFormProps) {
  const [form, setForm] = useState<FormState>(initial ?? emptyForm);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.kind.trim()) {
      setError("kind is required");
      return;
    }
    if (!form.of.trim() || !form.require.trim()) {
      setError("pattern.of and pattern.require are required");
      return;
    }
    if (!Number.isFinite(form.maxLagMs) || form.maxLagMs <= 0) {
      setError("maxLagMs must be a positive number");
      return;
    }
    onSubmit(form);
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-md border border-border bg-card p-4 text-xs"
    >
      <div>
        <label className="mb-1 block font-medium">kind</label>
        <input
          type="text"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          placeholder="e.g. watchtower.query-roundtrip"
          className="w-full rounded-md border border-border bg-background px-2 py-1.5"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block font-medium">pattern.of</label>
          <input
            type="text"
            value={form.of}
            onChange={(e) => setForm({ ...form, of: e.target.value })}
            placeholder="watchtower.query.sent"
            list="event-constraint-kinds"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono"
          />
        </div>
        <div>
          <label className="mb-1 block font-medium">pattern.require</label>
          <input
            type="text"
            value={form.require}
            onChange={(e) => setForm({ ...form, require: e.target.value })}
            placeholder="watchtower.query.response"
            list="event-constraint-kinds"
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono"
          />
        </div>
      </div>
      <datalist id="event-constraint-kinds">
        {kindSuggestions.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block font-medium">maxLagMs</label>
          <input
            type="number"
            min={1}
            value={form.maxLagMs}
            onChange={(e) => setForm({ ...form, maxLagMs: Number(e.target.value) })}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>enabled</span>
          </label>
        </div>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-background px-3 py-1.5 hover:bg-muted/50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function EventConstraints() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const qc = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Event Constraints" }]);
  }, [setBreadcrumbs]);

  const listQuery = useQuery({
    queryKey: ["event-constraints", "list", selectedCompanyId],
    queryFn: () =>
      eventConstraintsApi.list({
        companyId: selectedCompanyId ?? undefined,
      }),
  });

  const kindsQuery = useQuery({
    queryKey: ["causal-events", "kinds"],
    queryFn: () => causalEventsApi.kinds(),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["event-constraints", "list"] });

  const createMut = useMutation({
    mutationFn: (input: EventConstraintInput) => eventConstraintsApi.create(input),
    onSuccess: () => {
      setShowCreate(false);
      invalidate();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: EventConstraintPatch }) =>
      eventConstraintsApi.update(id, patch),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => eventConstraintsApi.remove(id),
    onSuccess: invalidate,
  });

  const constraints = listQuery.data?.constraints ?? [];
  const kindSuggestions = kindsQuery.data?.kinds ?? [];

  function handleCreate(form: FormState) {
    const body: EventConstraintInput = {
      kind: form.kind.trim(),
      pattern: { of: form.of.trim(), require: form.require.trim() },
      maxLagMs: form.maxLagMs,
      enabled: form.enabled,
      companyId: selectedCompanyId ?? null,
    };
    createMut.mutate(body);
  }

  function handleUpdate(id: string, form: FormState) {
    const patch: EventConstraintPatch = {
      kind: form.kind.trim(),
      pattern: { of: form.of.trim(), require: form.require.trim() },
      maxLagMs: form.maxLagMs,
      enabled: form.enabled,
    };
    updateMut.mutate({ id, patch });
  }

  function handleToggle(c: EventConstraint) {
    updateMut.mutate({ id: c.id, patch: { enabled: !c.enabled } });
  }

  function handleDelete(c: EventConstraint) {
    if (!window.confirm(`Delete constraint "${c.kind}"? This cannot be undone.`)) {
      return;
    }
    deleteMut.mutate(c.id);
  }

  function toFormState(c: EventConstraint): FormState {
    return {
      kind: c.kind,
      of: c.pattern.of,
      require: c.pattern.require,
      maxLagMs: c.maxLagMs,
      enabled: c.enabled,
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Pattern-match rules checked every 5 min by the causal-constraints cron.
          Each rule emits a <code className="font-mono">causal.constraint.violated</code> event when
          a <code className="font-mono">pattern.of</code> event lacks a matching{" "}
          <code className="font-mono">pattern.require</code> child within{" "}
          <code className="font-mono">maxLagMs</code>.
        </p>
        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Constraint
          </button>
        )}
      </div>

      {showCreate && (
        <ConstraintForm
          submitting={createMut.isPending}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          kindSuggestions={kindSuggestions}
          submitLabel="Create"
        />
      )}

      {createMut.error && (
        <p className="text-xs text-destructive">
          {createMut.error instanceof Error ? createMut.error.message : "Failed to create"}
        </p>
      )}
      {updateMut.error && (
        <p className="text-xs text-destructive">
          {updateMut.error instanceof Error ? updateMut.error.message : "Failed to update"}
        </p>
      )}
      {deleteMut.error && (
        <p className="text-xs text-destructive">
          {deleteMut.error instanceof Error ? deleteMut.error.message : "Failed to delete"}
        </p>
      )}

      {listQuery.isLoading && <PageSkeleton variant="list" />}
      {listQuery.error && (
        <p className="text-xs text-destructive">
          {listQuery.error instanceof Error
            ? listQuery.error.message
            : "Failed to load constraints"}
        </p>
      )}

      {!listQuery.isLoading && constraints.length === 0 && (
        <EmptyState
          icon={ShieldAlert}
          message="No event constraints defined yet."
        />
      )}

      {constraints.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Enabled</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">of → require</th>
                <th className="px-3 py-2">maxLagMs</th>
                <th className="px-3 py-2 text-right">Violations</th>
                <th className="px-3 py-2">Last violation</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {constraints.map((c) => {
                const isEditing = editingId === c.id;
                return (
                  <Fragment key={c.id}>
                    <tr className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={c.enabled}
                          onChange={() => handleToggle(c)}
                          disabled={updateMut.isPending}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono font-semibold">{c.kind}</td>
                      <td className="px-3 py-2 font-mono">
                        {c.pattern.of}{" "}
                        <span className="text-muted-foreground">→</span> {c.pattern.require}
                      </td>
                      <td className="px-3 py-2">{c.maxLagMs}</td>
                      <td className="px-3 py-2 text-right">{c.violationCount}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatTime(c.lastViolationAt)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingId(isEditing ? null : c.id)}
                            className="rounded p-1 hover:bg-muted/50"
                            title={isEditing ? "Cancel edit" : "Edit"}
                          >
                            {isEditing ? (
                              <X className="h-3.5 w-3.5" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(c)}
                            className="rounded p-1 text-destructive hover:bg-destructive/10"
                            title="Delete"
                            disabled={deleteMut.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="border-t border-border bg-muted/20">
                        <td colSpan={7} className="px-3 py-3">
                          <ConstraintForm
                            initial={toFormState(c)}
                            submitting={updateMut.isPending}
                            onSubmit={(form) => handleUpdate(c.id, form)}
                            onCancel={() => setEditingId(null)}
                            kindSuggestions={kindSuggestions}
                            submitLabel="Save"
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
