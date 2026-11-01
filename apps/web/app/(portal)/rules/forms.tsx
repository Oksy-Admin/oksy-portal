"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  findRuleConflicts,
  RULE_FIELD_KEYS,
  RULE_FIELDS,
  type ConditionOperator,
  type DateBasis,
  type ExistingCheckVersion,
  type RuleAction as EngineRuleAction,
  type RuleConflict,
  type SimpleCondition,
} from "@oksy/rules";
import {
  getRuleTestResultAction,
  queueRuleTestAction,
  saveCheckRuleAction,
  saveParameterRuleAction,
  suggestRuleFromPlainWordsAction,
  type RuleTestResultData,
} from "./actions";

const SCHEMES = ["PRIVATE", "KASP", "MEDISEP"];
const SEVERITIES: Array<{ value: "E" | "W"; label: string }> = [
  { value: "E", label: "E - Error (cannot be confirmed away)" },
  { value: "W", label: "W - Warning (staff may confirm 'value is correct')" },
];
const ACTIONS: Array<{ value: EngineRuleAction; label: string }> = [
  { value: "AUTOMATIC", label: "Automatic (a plain data fix, no judgement)" },
  { value: "AI_SUGGESTION", label: "AI suggestion (goes to the decision list)" },
  { value: "ASK_STAFF", label: "Ask hospital staff (Question Sheet)" },
];
const OPERATORS: Array<{ value: ConditionOperator; label: string; needsValue: boolean }> = [
  { value: "EMPTY", label: "is empty", needsValue: false },
  { value: "NOT_EMPTY", label: "is not empty", needsValue: false },
  { value: "EQUALS", label: "equals", needsValue: true },
  { value: "NOT_EQUALS", label: "does not equal", needsValue: true },
  { value: "GREATER_THAN", label: "is greater than", needsValue: true },
  { value: "LESS_THAN", label: "is less than", needsValue: true },
  { value: "BEFORE", label: "is before", needsValue: true },
  { value: "AFTER", label: "is after", needsValue: true },
  { value: "DIFFERS_BY_MORE_THAN", label: "differs by more than", needsValue: true },
  { value: "FLAG_TRUE", label: "is true", needsValue: false },
  { value: "FLAG_FALSE", label: "is false", needsValue: false },
];
const NO_VALUE = new Set<ConditionOperator>(["EMPTY", "NOT_EMPTY", "FLAG_TRUE", "FLAG_FALSE"]);
const MAX_CONDITIONS = 5;

interface ConditionDraft {
  field: string;
  operator: ConditionOperator;
  compareWith: "FIELD" | "VALUE" | "TODAY" | "NONE";
  compareField: string;
  compareValue: string;
  offsetDays: string;
  toleranceAmount: string;
}

const emptyCondition = (): ConditionDraft => ({
  field: RULE_FIELD_KEYS[0]!,
  operator: "NOT_EMPTY",
  compareWith: "NONE",
  compareField: RULE_FIELD_KEYS[0]!,
  compareValue: "",
  offsetDays: "0",
  toleranceAmount: "",
});

function toSimpleCondition(c: ConditionDraft): SimpleCondition | { error: string } {
  const cond: SimpleCondition = { field: c.field, operator: c.operator };
  if (c.toleranceAmount.trim()) cond.toleranceAmount = Number(c.toleranceAmount);
  if (NO_VALUE.has(c.operator)) return cond;
  if (c.compareWith === "FIELD") {
    cond.compareField = c.compareField;
  } else if (c.compareWith === "TODAY") {
    cond.compareValue = "TODAY";
    cond.offsetDays = Number(c.offsetDays || 0);
  } else if (c.compareWith === "VALUE") {
    if (c.compareValue.trim() === "") return { error: `"${c.field}" needs a value to compare with` };
    const n = Number(c.compareValue);
    cond.compareValue = /^-?\d+(\.\d+)?$/.test(c.compareValue.trim()) && !Number.isNaN(n) ? n : c.compareValue.trim();
  } else {
    return { error: `choose what "${c.field}" is compared with` };
  }
  return cond;
}

function fromSimpleCondition(c: SimpleCondition): ConditionDraft {
  return {
    field: c.field,
    operator: c.operator,
    compareWith: c.compareField ? "FIELD" : c.compareValue === "TODAY" ? "TODAY" : c.compareValue !== undefined ? "VALUE" : "NONE",
    compareField: c.compareField ?? RULE_FIELD_KEYS[0]!,
    compareValue: c.compareValue !== undefined && c.compareValue !== "TODAY" ? String(c.compareValue) : "",
    offsetDays: String(c.offsetDays ?? 0),
    toleranceAmount: c.toleranceAmount !== undefined ? String(c.toleranceAmount) : "",
  };
}

export interface RuleFormInitial {
  ruleId: string;
  ruleType: "CHECK" | "PARAMETER";
  title: string;
  severity: "E" | "W";
  action: EngineRuleAction;
  staffMessage: string;
  hospitalFilter: string | null;
  schemeFilter: string | null;
  insurerFilter: string | null;
  validFrom: string | null;
  validTo: string | null;
  dateBasis: DateBasis | null;
  checkDefinition: { kind: "SIMPLE"; logic: "AND" | "OR"; conditions: SimpleCondition[]; issueField: string } | null;
  parameterName: string | null;
  parameterValue: number | null;
}

export function RuleForm({
  mode,
  initial,
  existingRules,
  hospitalOptions,
  onDone,
  onCancel,
}: {
  mode: "ADD" | "EDIT";
  initial: RuleFormInitial | null;
  /** Latest version of every OTHER rule, for the save-time conflict check (same data already on the page). */
  existingRules: ExistingCheckVersion[];
  hospitalOptions: Array<{ code: string; name: string }>;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [ruleType, setRuleType] = useState<"CHECK" | "PARAMETER">(initial?.ruleType ?? "CHECK");
  const [ruleId, setRuleId] = useState(initial?.ruleId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [hospitalFilter, setHospitalFilter] = useState(initial?.hospitalFilter ?? "");
  const [schemeFilter, setSchemeFilter] = useState(initial?.schemeFilter ?? "");
  const [insurerFilter, setInsurerFilter] = useState(initial?.insurerFilter ?? "");
  const [validFrom, setValidFrom] = useState(initial?.validFrom ?? "");
  const [validTo, setValidTo] = useState(initial?.validTo ?? "");
  const [dateBasis, setDateBasis] = useState<DateBasis | "">(initial?.dateBasis ?? "");

  const [logic, setLogic] = useState<"AND" | "OR">(initial?.checkDefinition?.logic ?? "AND");
  const [conditions, setConditions] = useState<ConditionDraft[]>(
    initial?.checkDefinition?.conditions.map(fromSimpleCondition) ?? [emptyCondition()],
  );
  const [issueField, setIssueField] = useState(initial?.checkDefinition?.issueField ?? RULE_FIELD_KEYS[0]!);
  const [severity, setSeverity] = useState<"E" | "W">(initial?.severity ?? "W");
  const [action, setAction] = useState<EngineRuleAction>(initial?.action ?? "ASK_STAFF");
  const [staffMessage, setStaffMessage] = useState(initial?.staffMessage ?? "");

  const [parameterName, setParameterName] = useState(initial?.parameterName ?? "");
  const [parameterValue, setParameterValue] = useState(initial?.parameterValue != null ? String(initial.parameterValue) : "");

  const [conflictReason, setConflictReason] = useState("");
  const [testId, setTestId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<"QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED" | null>(null);
  const [testResult, setTestResult] = useState<RuleTestResultData | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testedSignature, setTestedSignature] = useState<string | null>(null);

  const [plainWords, setPlainWords] = useState("");
  const [plainWordsError, setPlainWordsError] = useState<string | null>(null);
  const [plainWordsPending, startPlainWords] = useTransition();

  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const conditionErrors = conditions.map(toSimpleCondition).filter((c): c is { error: string } => "error" in c);
  const builtConditions = conditions.map(toSimpleCondition).filter((c): c is SimpleCondition => !("error" in c));
  const checkDefinition = useMemo(
    () => (ruleType === "CHECK" && conditionErrors.length === 0 ? { kind: "SIMPLE" as const, logic, conditions: builtConditions, issueField } : null),
    [ruleType, conditionErrors.length, logic, builtConditions, issueField],
  );

  const draftSignature = JSON.stringify({ checkDefinition, hospitalFilter, schemeFilter, insurerFilter, validFrom, validTo, dateBasis });

  const conflicts: RuleConflict[] =
    ruleType === "CHECK" && checkDefinition
      ? findRuleConflicts(
          { ruleId: ruleId || "DRAFT", type: "CHECK", checkDefinition, hospitalFilter: hospitalFilter || null, schemeFilter: schemeFilter || null, insurerFilter: insurerFilter || null },
          existingRules,
        )
      : ruleType === "PARAMETER" && parameterName && parameterValue
        ? findRuleConflicts(
            { ruleId: ruleId || "DRAFT", type: "PARAMETER", parameterName, parameterValue, hospitalFilter: hospitalFilter || null, schemeFilter: schemeFilter || null, insurerFilter: insurerFilter || null },
            existingRules,
          )
        : [];

  useEffect(() => {
    if (!testId || testStatus === "SUCCEEDED" || testStatus === "FAILED" || testStatus === "STOPPED") return;
    pollRef.current = setInterval(async () => {
      const res = await getRuleTestResultAction(testId);
      if (!res.ok) return;
      setTestStatus(res.status ?? null);
      if (res.status === "SUCCEEDED") {
        setTestResult(res.result ?? null);
        setTestedSignature(draftSignature);
      }
      if (res.status === "FAILED") setTestError(res.jobError ?? "The test could not run.");
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId, testStatus]);

  const runTest = () => {
    setTestResult(null);
    setTestError(null);
    setTestStatus(null);
    startTransition(async () => {
      const res = await queueRuleTestAction({
        ruleId: ruleId || "DRAFT",
        type: ruleType,
        severity: ruleType === "CHECK" ? severity : null,
        action: ruleType === "CHECK" ? action : null,
        staffMessage: ruleType === "CHECK" ? staffMessage : null,
        checkDefinition,
        hospitalFilter: hospitalFilter || null,
        schemeFilter: schemeFilter || null,
        insurerFilter: insurerFilter || null,
        validFrom: validFrom || null,
        validTo: validTo || null,
        dateBasis: dateBasis || null,
      });
      if (!res.ok) {
        setTestError(res.error ?? "Could not queue the test.");
        return;
      }
      setTestId(res.id ?? null);
      setTestStatus("QUEUED");
    });
  };

  const runPlainWords = () => {
    setPlainWordsError(null);
    startPlainWords(async () => {
      const res = await suggestRuleFromPlainWordsAction(plainWords);
      if (!res.ok || !res.suggestion) {
        setPlainWordsError(res.error ?? "No suggestion came back.");
        return;
      }
      const s = res.suggestion;
      setRuleType("CHECK");
      setTitle(s.title);
      setSeverity(s.severity);
      setAction(s.action);
      setStaffMessage(s.staffMessage);
      setLogic(s.logic);
      setConditions(s.conditions.map(fromSimpleCondition));
      setIssueField(s.issueField);
      setHospitalFilter(s.hospitalFilter ?? "");
      setSchemeFilter(s.schemeFilter ?? "");
      setInsurerFilter(s.insurerFilter ?? "");
    });
  };

  const addCondition = () => conditions.length < MAX_CONDITIONS && setConditions([...conditions, emptyCondition()]);
  const removeCondition = (i: number) => setConditions(conditions.filter((_, idx) => idx !== i));
  const updateCondition = (i: number, patch: Partial<ConditionDraft>) => setConditions(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const canSaveCheck = ruleType === "CHECK" && testedSignature === draftSignature && testResult !== null;
  const needsConflictReason = conflicts.length > 0 && conflictReason.trim() === "";

  const save = () => {
    setMessage(null);
    if (!ruleId.trim() || !title.trim()) {
      setMessage({ text: "Rule ID and title are required.", ok: false });
      return;
    }
    if (needsConflictReason) {
      setMessage({ text: "A reason is required to save over the conflict shown below.", ok: false });
      return;
    }
    startTransition(async () => {
      if (ruleType === "CHECK") {
        if (!checkDefinition) {
          setMessage({ text: "Fix the condition errors first.", ok: false });
          return;
        }
        if (!canSaveCheck) {
          setMessage({ text: "Run the test again: the draft changed since the last test.", ok: false });
          return;
        }
        const res = await saveCheckRuleAction({
          ruleId: ruleId.trim().toUpperCase(),
          title: title.trim(),
          severity,
          action,
          staffMessage,
          checkDefinition,
          hospitalFilter: hospitalFilter || null,
          schemeFilter: schemeFilter || null,
          insurerFilter: insurerFilter || null,
          validFrom: validFrom || null,
          validTo: validTo || null,
          dateBasis: dateBasis || null,
          conflictRuleIds: conflicts.map((c) => c.otherRuleId),
          conflictReason: conflictReason || undefined,
        });
        if (!res.ok) {
          setMessage({ text: res.error ?? "Could not save.", ok: false });
          return;
        }
        onDone(`${ruleId.trim().toUpperCase()} saved as version ${res.version} (PROPOSED; activate it from the list when ready).`);
      } else {
        if (!parameterName.trim() || !parameterValue.trim()) {
          setMessage({ text: "Parameter name and value are required.", ok: false });
          return;
        }
        const res = await saveParameterRuleAction({
          ruleId: ruleId.trim().toUpperCase(),
          title: title.trim(),
          parameterName: parameterName.trim(),
          parameterValue,
          hospitalFilter: hospitalFilter || null,
          schemeFilter: schemeFilter || null,
          insurerFilter: insurerFilter || null,
          validFrom: validFrom || null,
          validTo: validTo || null,
          dateBasis: dateBasis || null,
          conflictRuleIds: conflicts.map((c) => c.otherRuleId),
          conflictReason: conflictReason || undefined,
        });
        if (!res.ok) {
          setMessage({ text: res.error ?? "Could not save.", ok: false });
          return;
        }
        onDone(`${ruleId.trim().toUpperCase()} saved as version ${res.version} (PROPOSED; activate it from the list when ready).`);
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea
            placeholder='Plain words: e.g. "Warn when the stay is over 45 days"'
            rows={2}
            style={{ flex: 1 }}
            value={plainWords}
            onChange={(e) => setPlainWords(e.target.value)}
          />
          <button type="button" className="btn secondary" disabled={plainWordsPending} onClick={runPlainWords}>
            {plainWordsPending ? "Drafting…" : "Fill from words"}
          </button>
        </label>
        {plainWordsError && <p className="notice warn" style={{ marginTop: 6 }}>{plainWordsError}</p>}
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>No claim or patient data is sent. Check, test and save the draft yourself -- the AI never saves.</p>
      </div>

      <fieldset style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 12 }}>
        <legend>Rule</legend>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 140 }}>
            Rule ID
            <input value={ruleId} onChange={(e) => setRuleId(e.target.value)} placeholder="e.g. R-W02" readOnly={mode === "EDIT"} required />
          </label>
          <label style={{ width: 160 }}>
            Rule type
            <select value={ruleType} onChange={(e) => setRuleType(e.target.value as "CHECK" | "PARAMETER")} disabled={mode === "EDIT"}>
              <option value="CHECK">Check (fires an issue)</option>
              <option value="PARAMETER">Parameter (a number other rules use)</option>
            </select>
          </label>
        </div>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Stay over 45 days" required />
        </label>
      </fieldset>

      <fieldset style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 12 }}>
        <legend>Which rows this applies to</legend>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ flex: 1, minWidth: 160 }}>
            Hospital (blank = all)
            <select value={hospitalFilter} onChange={(e) => setHospitalFilter(e.target.value)}>
              <option value="">All hospitals</option>
              {hospitalOptions.map((h) => (
                <option key={h.code} value={h.code}>{h.name}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 140 }}>
            Scheme (blank = all)
            <select value={schemeFilter} onChange={(e) => setSchemeFilter(e.target.value)}>
              <option value="">All schemes</option>
              {SCHEMES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 140 }}>
            Insurer / TPA (blank = all)
            <input value={insurerFilter} onChange={(e) => setInsurerFilter(e.target.value)} placeholder="e.g. Star Health" />
          </label>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
          <label style={{ flex: 1, minWidth: 140 }}>
            Valid from
            <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: 140 }}>
            Valid to
            <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </label>
          <label style={{ flex: 1, minWidth: 160 }}>
            Which date (if dated)
            <select value={dateBasis} onChange={(e) => setDateBasis(e.target.value as DateBasis | "")}>
              <option value="">Discharge (default)</option>
              <option value="ADMISSION">Admission</option>
              <option value="DISCHARGE">Discharge</option>
              <option value="SETTLEMENT">Settlement</option>
            </select>
          </label>
        </div>
      </fieldset>

      {ruleType === "CHECK" ? (
        <fieldset style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 12 }}>
          <legend>What to check (up to 5 conditions)</legend>
          <label style={{ width: 160 }}>
            Match
            <select value={logic} onChange={(e) => setLogic(e.target.value as "AND" | "OR")}>
              <option value="AND">All conditions (AND)</option>
              <option value="OR">Any condition (OR)</option>
            </select>
          </label>
          {conditions.map((c, i) => {
            const op = OPERATORS.find((o) => o.value === c.operator)!;
            return (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: i > 0 ? "1px solid var(--border, #eee)" : undefined }}>
                <label style={{ minWidth: 180 }}>
                  Field
                  <select value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value })}>
                    {RULE_FIELD_KEYS.map((k) => <option key={k} value={k}>{RULE_FIELDS[k]!.label}</option>)}
                  </select>
                </label>
                <label style={{ minWidth: 160 }}>
                  Operator
                  <select value={c.operator} onChange={(e) => updateCondition(i, { operator: e.target.value as ConditionOperator })}>
                    {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                {op.needsValue && (
                  <>
                    <label style={{ minWidth: 150 }}>
                      Compared with
                      <select value={c.compareWith} onChange={(e) => updateCondition(i, { compareWith: e.target.value as ConditionDraft["compareWith"] })}>
                        <option value="VALUE">A fixed value</option>
                        <option value="FIELD">Another field</option>
                        <option value="TODAY">Today ± days</option>
                      </select>
                    </label>
                    {c.compareWith === "FIELD" && (
                      <label style={{ minWidth: 180 }}>
                        Field
                        <select value={c.compareField} onChange={(e) => updateCondition(i, { compareField: e.target.value })}>
                          {RULE_FIELD_KEYS.map((k) => <option key={k} value={k}>{RULE_FIELDS[k]!.label}</option>)}
                        </select>
                      </label>
                    )}
                    {c.compareWith === "VALUE" && (
                      <label style={{ minWidth: 120 }}>
                        Value
                        <input value={c.compareValue} onChange={(e) => updateCondition(i, { compareValue: e.target.value })} placeholder="number or YYYY-MM-DD" />
                      </label>
                    )}
                    {c.compareWith === "TODAY" && (
                      <label style={{ minWidth: 120 }}>
                        Offset days
                        <input type="number" value={c.offsetDays} onChange={(e) => updateCondition(i, { offsetDays: e.target.value })} placeholder="e.g. -60" />
                      </label>
                    )}
                    {c.operator === "DIFFERS_BY_MORE_THAN" && (
                      <label style={{ minWidth: 100 }}>
                        Tolerance
                        <input value={c.toleranceAmount} onChange={(e) => updateCondition(i, { toleranceAmount: e.target.value })} placeholder="e.g. 1" />
                      </label>
                    )}
                  </>
                )}
                {conditions.length > 1 && (
                  <button type="button" className="btn small secondary" onClick={() => removeCondition(i)}>Remove</button>
                )}
              </div>
            );
          })}
          {conditions.length < MAX_CONDITIONS && (
            <button type="button" className="btn small secondary" style={{ marginTop: 8 }} onClick={addCondition}>+ Add condition</button>
          )}
          {conditionErrors.length > 0 && (
            <p className="notice warn" style={{ marginTop: 8 }}>{conditionErrors[0]!.error}</p>
          )}
          <label style={{ marginTop: 8, display: "block" }}>
            Issue shown against
            <select value={issueField} onChange={(e) => setIssueField(e.target.value)}>
              {RULE_FIELD_KEYS.map((k) => <option key={k} value={k}>{RULE_FIELDS[k]!.label}</option>)}
            </select>
          </label>
        </fieldset>
      ) : (
        <fieldset style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 12 }}>
          <legend>Parameter</legend>
          <div style={{ display: "flex", gap: 12 }}>
            <label style={{ flex: 1 }}>
              Name
              <input value={parameterName} onChange={(e) => setParameterName(e.target.value)} placeholder="e.g. tds_rate" />
            </label>
            <label style={{ flex: 1 }}>
              Value
              <input value={parameterValue} onChange={(e) => setParameterValue(e.target.value)} placeholder="e.g. 0.10" />
            </label>
          </div>
        </fieldset>
      )}

      {ruleType === "CHECK" && (
        <fieldset style={{ border: "1px solid var(--border, #ddd)", borderRadius: 8, padding: 12 }}>
          <legend>What to do</legend>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 220 }}>
              Severity
              <select value={severity} onChange={(e) => setSeverity(e.target.value as "E" | "W")}>
                {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label style={{ flex: 1, minWidth: 220 }}>
              Action
              <select value={action} onChange={(e) => setAction(e.target.value as EngineRuleAction)}>
                {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </label>
          </div>
          <label>
            Message to staff ({"{field_name}"} inserts a value)
            <textarea rows={2} value={staffMessage} onChange={(e) => setStaffMessage(e.target.value)} placeholder="e.g. Stay is {los_days} days; please confirm the dates." />
          </label>
        </fieldset>
      )}

      {conflicts.length > 0 && (
        <div className="notice warn">
          <strong>Conflict:</strong> this scope and field already has a rule that disagrees.
          <ul style={{ margin: "6px 0 6px 18px" }}>
            {conflicts.map((c, i) => <li key={i}>{c.reason}</li>)}
          </ul>
          <label>
            Reason to save anyway
            <input value={conflictReason} onChange={(e) => setConflictReason(e.target.value)} placeholder="e.g. different insurers, both correct" />
          </label>
        </div>
      )}

      {ruleType === "CHECK" && (
        <div className="card" style={{ background: "var(--bg-muted, #f7f7f7)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <strong>Test before save</strong>
            <button type="button" className="btn secondary" disabled={isPending || conditionErrors.length > 0} onClick={runTest}>
              {testStatus === "QUEUED" || testStatus === "RUNNING" ? "Running…" : "Run test"}
            </button>
          </div>
          {testError && <p className="notice warn" style={{ marginTop: 8 }}>{testError}</p>}
          {testResult && testedSignature === draftSignature && (
            <div style={{ marginTop: 8 }}>
              <p>{testResult.claimsScanned} stored claim(s) in scope; {Object.values(testResult.hitsByHospital).reduce((a, b) => a + b, 0)} hit(s).</p>
              {Object.keys(testResult.hitsByHospital).length > 0 && (
                <ul style={{ margin: "4px 0 4px 18px" }}>
                  {Object.entries(testResult.hitsByHospital).map(([h, n]) => <li key={h}>{h}: {n}</li>)}
                </ul>
              )}
              {testResult.examples.length > 0 && (
                <p className="muted" style={{ fontSize: 13 }}>Example rows: {testResult.examples.map((e) => `${e.hospitalCode} ${e.tab} row ${e.row}`).join(", ")}</p>
              )}
            </div>
          )}
          {testResult === null && !testError && (
            <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Not tested yet (needed before Save). Runs against the stored claims of this scope, read only.</p>
          )}
          {testedSignature !== null && testedSignature !== draftSignature && (
            <p className="notice warn" style={{ marginTop: 8 }}>The draft changed since the last test; run it again.</p>
          )}
        </div>
      )}

      {message && (
        <p className={message.ok ? "notice" : "notice warn"} role={message.ok ? "status" : "alert"}>{message.text}</p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button type="button" className="btn secondary" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="btn"
          disabled={isPending || (ruleType === "CHECK" && (!canSaveCheck || conditionErrors.length > 0))}
          onClick={save}
          title={ruleType === "CHECK" && !canSaveCheck ? "Run the test first" : undefined}
        >
          {isPending ? "Saving…" : mode === "ADD" ? "Save Rule" : "Save as new version"}
        </button>
      </div>
    </div>
  );
}
