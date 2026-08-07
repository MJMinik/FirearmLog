// (4) THE READ-BOUNDARY KEEPER (session 107, 6 Aug 2026).
//
// `src/lib/recordShape.ts` fills in any field the model declares as a required
// string but the stored data does not actually carry. That map is written by
// hand. This script checks two things the TypeScript type system cannot express:
//
// (1) THE `??` GUARD (checkNullishOnNormalisedFields, ~65 lines).
//     Once a field is normalised it is never undefined or null, so `?? fallback`
//     on it can never fire. A fallback that can never fire reads like a live guard,
//     which is dangerous: MatchScreens.tsx carried a three-line comment explaining
//     why its `?? MATCH_TYPES[0]` mattered, and the read boundary had silently
//     switched it off. This check finds those dead fallbacks across all of src/.
//
// (2) THE "NO UNMAPPED NESTED ROW TYPE" GUARD (lines near the bottom).
//     When a named interface is used as an array element inside a mapped store,
//     it must appear in NESTED_FOR_TYPE or NESTED_EXEMPT. This catches the case
//     where a new nested row type (e.g. MatchStageComment[]) is added to the
//     model and the shape map is not updated. The type system cannot express this
//     because the question is about ABSENCE from a map, not shape of a value.
//
// (3) THE EMPTY-MODEL REFUSAL.
//     If types.ts declares none of the record interfaces, the type-level
//     `satisfies ExpectedRecordShape` check in recordShape.ts would still pass
//     (because ExpectedRecordShape requires what RecordTypeForStore declares, and
//     RecordTypeForStore imports from types.ts). A deliberate refusal catches that.
//
// WHAT THIS NO LONGER CHECKS (moved to the type system):
//     The field-agreement check -- "does RECORD_SHAPE list every required plain
//     string from every record interface?" -- now lives as a `satisfies` clause
//     in src/lib/recordShape.ts. Any drift causes `npx tsc --noEmit` to fail,
//     which already runs on every build. See that file's header comment for how
//     to read the tsc error when the satisfies clause fires.
//
// WHY THIS USES THE TYPESCRIPT COMPILER AND NOT A REGEX. The first version parsed
// types.ts one line at a time. A cold audit then wrote nine perfectly ordinary
// declarations it did not see. A keeper with nine known holes is worse than no
// keeper, because it is trusted. TypeScript's own parser has none of those holes.
//
// WHAT THIS STILL DOES NOT SEE, stated rather than implied. A record interface
// rewritten as a TYPE ALIAS (`export type Classifier = BaseRecord & { ... }`) is
// skipped, because the walk below visits interface declarations only -- measured
// by a fourth audit round, not assumed. So is a computed property name
// (`["clubName"]: string`). Neither shape exists in `types.ts` today and neither
// is a natural way to write it, but a hole written down is a different thing from
// a hole nobody knows about.
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const TYPES_FILE = 'src/lib/types.ts';
const SHAPE_FILE = 'src/lib/recordShape.ts';

// Which interface backs which IndexedDB store.
const STORE_FOR_TYPE = {
  Firearm: 'firearms', Session: 'sessions', DrillDef: 'drills', Ammunition: 'ammunition',
  Purchase: 'purchases', MaintenanceEntry: 'maintenance', MalfunctionEntry: 'malfunctions',
  Magazine: 'magazines', Optic: 'optics', Part: 'parts', Goal: 'goals',
  SkillAssessment: 'skills', SkillSet: 'skillSets', Match: 'matches',
  Classifier: 'classifiers', Reference: 'references', Reminder: 'reminders',
  Media: 'media', TrashItem: 'trash',
};

// Named nested row types, and the [store, array field] whose records embed them.
const NESTED_FOR_TYPE = {
  SessionGun: ['sessions', 'guns'], DrillResult: ['sessions', 'drills'],
  MatchStage: ['matches', 'stages'], Mark: ['media', 'marks'],
};

// Nested arrays deliberately left out of the shape map, each with its reason.
// `sessions.guns.magOverrides` sits TWO levels deep (session -> gun -> override),
// which StoreShape cannot express, and its only string, `magId`, is used solely as
// an object key and in equality tests -- never as the receiver of a string method,
// so it cannot produce this crash. Checked in SessionForm.tsx and lib/mags.ts, not
// assumed. Anything added here has to carry a reason like this one.
const NESTED_EXEMPT = new Set(['SessionGun.magOverrides']);

/**
 * (5) THE `??` KEEPER.
 *
 * Once a field is normalised it is never `undefined` or `null`, so `?? fallback`
 * on it can never fire. The fallback still READS like a live guard, which is worse
 * than having none: `MatchScreens.tsx` carried a three-line comment explaining
 * exactly why its `?? MATCH_TYPES[0]` mattered, and the read boundary had silently
 * switched it off. That one was caught by an audit round. The next will be written
 * a year from now by someone who has never heard of any of this.
 *
 * `||` is correct on a normalised field and `??` is not, because empty and absent
 * now mean the same thing.
 *
 * THIS IS TYPE-AWARE, AND IT HAS TO BE. The first version matched the TEXT
 * `.<field> ??` and returned 61 hits, nearly all of them wrong -- record fields are
 * called `name`, `date`, `label`, `notes`, so the match fired on an Error object's
 * `.name`, on CSV column descriptors, on local form state. A check that cries wolf
 * 61 times is not a keeper; it is something everyone learns to skip. So the
 * receiver's TYPE is resolved and the flag fires only when it really is one of the
 * record types the boundary normalises. Slower, and the only version worth having.
 *
 * `normalise-ok` on the line marks a deliberate exception.
 */
function checkNullishOnNormalisedFields(report, shapeByType) {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  if (config.error) { report('NULLISH CHECK: cannot read tsconfig.json'); return; }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, '.');
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, skipLibCheck: true });
  const checker = program.getTypeChecker();

  /**
   * The record type behind an expression -- but ONLY when that expression cannot
   * itself be undefined or null.
   *
   * This distinction is the whole check. `firearms.find(f => f.id === id)?.name ?? '—'`
   * is CORRECT code: the `??` is catching the FIND missing, not the field being
   * absent, and rewriting it to `||` would change nothing while removing a real
   * guard. A first pass unwrapped `Firearm | undefined` to `Firearm` and flagged
   * twenty-nine of those, every one of them wrong. If the receiver can be nothing,
   * the `??` has a job.
   */
  const recordTypeOf = (expr) => {
    const t = checker.getTypeAtLocation(expr);
    const parts = t.isUnion() ? t.types : [t];
    if (parts.some((p) => p.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))) return null;
    for (const part of parts) {
      const name = part.getSymbol()?.getName();
      if (name && shapeByType.has(name)) return name;
    }
    return null;
  };

  for (const file of program.getSourceFiles()) {
    const rel = file.fileName.replace(/\\/g, '/').replace(/^.*?\/(src\/)/, '$1');
    if (!rel.startsWith('src/') || rel === 'src/lib/recordShape.ts') continue;
    const lines = file.getFullText().split('\n');
    const visit = (node) => {
      if (ts.isBinaryExpression(node)
          && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
          && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
          && ts.isPropertyAccessExpression(node.left)) {
        // `?? ''` on a normalised field is HARMLESS -- redundant, but it produces
        // exactly the value the boundary already guarantees, so nothing is hidden
        // and nothing behaves unexpectedly. The hazard is a fallback that is
        // SOMETHING ELSE: `?? MATCH_TYPES[0]`, `?? 'Match'`. Those read as live
        // guards, never fire, and the code behaves as if the author's intent had
        // been deleted -- which is precisely what happened to the Edit Match picker.
        // Flagging the harmless ones too produced nine findings whose only fix was
        // to churn correct code, and noise is how a keeper gets ignored.
        const fallback = node.right;
        const isEmptyString = ts.isStringLiteral(fallback) && fallback.text === '';
        if (isEmptyString) { ts.forEachChild(node, visit); return; }
        const field = node.left.name.getText();
        const owner = recordTypeOf(node.left.expression);
        if (owner && shapeByType.get(owner)?.has(field)) {
          const { line } = file.getLineAndCharacterOfPosition(node.getStart());
          if (!(lines[line] ?? '').includes('normalise-ok')) {
            report(`NULLISH ON A NORMALISED FIELD: ${rel}:${line + 1} — \`${owner}.${field} ??\` can never fire, because the read boundary fills that field with ''. Use \`||\` (empty and absent mean the same thing for it), or mark the line \`normalise-ok\` if the distinction is real.`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
}

export function checkRecordShape(report) {
  // Parse types.ts to check model interfaces are present and find nested arrays.
  const program = ts.createProgram([TYPES_FILE], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    strict: true, strictNullChecks: true, skipLibCheck: true,
  });
  const source = program.getSourceFile(TYPES_FILE);
  if (!source) { report(`RECORD SHAPE: cannot read ${TYPES_FILE}`); return; }

  // An EMPTY or record-free types.ts would otherwise appear clean because the
  // type-level `satisfies` check only verifies the map against RecordTypeForStore,
  // not that RecordTypeForStore has any substance. Refuse instead.
  if (!source.statements.some((s) => ts.isInterfaceDeclaration(s) && STORE_FOR_TYPE[s.name.text])) {
    report(`RECORD SHAPE: ${TYPES_FILE} declares none of the record interfaces -- refusing to report clean`);
    return;
  }

  // Parse recordShape.ts's RECORD_SHAPE value so shapeByType can be built for
  // the ?? checker below. The compiler parser is used rather than a regex for
  // the same reasons documented at the top: nine classes of declaration a line-
  // by-line parser would miss.
  let shapeText;
  try {
    shapeText = readFileSync(SHAPE_FILE, 'utf8');
  } catch {
    report(`RECORD SHAPE: ${SHAPE_FILE} is missing -- the read boundary's shape map is gone`);
    return;
  }
  const shapeSource = ts.createSourceFile(SHAPE_FILE, shapeText, ts.ScriptTarget.ES2022, true);
  const declared = {};
  const literalStrings = (node) => node.elements.map((e) => (ts.isStringLiteral(e) ? e.text : null))
    .filter((x) => x !== null);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && (node.name.getText() === 'RECORD_SHAPE_LITERAL' || node.name.getText() === 'RECORD_SHAPE')) {
      // Unwrap `as const satisfies T` (SatisfiesExpression wrapping an AsExpression)
      // and any parentheses, to reach the ObjectLiteralExpression underneath.
      let init = node.initializer;
      while (init && (
        ts.isAsExpression(init) ||
        ts.isParenthesizedExpression(init) ||
        ts.isSatisfiesExpression(init)
      )) init = init.expression;
      if (init && ts.isObjectLiteralExpression(init)) {
        for (const store of init.properties) {
          if (!ts.isPropertyAssignment(store)) continue;
          const name = store.name.getText().replace(/['"]/g, '');
          const entry = { strings: [], nested: {} };
          if (ts.isObjectLiteralExpression(store.initializer)) {
            for (const p of store.initializer.properties) {
              if (!ts.isPropertyAssignment(p)) continue;
              const key = p.name.getText().replace(/['"]/g, '');
              if (key === 'strings' && ts.isArrayLiteralExpression(p.initializer)) {
                entry.strings = literalStrings(p.initializer);
              } else if (key === 'nested' && ts.isObjectLiteralExpression(p.initializer)) {
                for (const n of p.initializer.properties) {
                  if (ts.isPropertyAssignment(n) && ts.isArrayLiteralExpression(n.initializer)) {
                    entry.nested[n.name.getText().replace(/['"]/g, '')] = literalStrings(n.initializer);
                  }
                }
              }
            }
          }
          declared[name] = entry;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(shapeSource);

  // A named nested row type that nobody mapped is invisible to the type-level
  // satisfies check, which only asks "does the map's value fit the interface?"
  // not "is every interface-backed array covered?" Catch the gap: any interface
  // referenced as an array element by a mapped store must appear in
  // NESTED_FOR_TYPE or NESTED_EXEMPT.
  const mapped = new Set([...Object.keys(STORE_FOR_TYPE), ...Object.keys(NESTED_FOR_TYPE)]);
  const checker = program.getTypeChecker();

  /** Required string-valued property names of one interface, own members only. */
  const ownStringProps = (decl) => {
    const out = [];
    for (const m of decl.members) {
      if (!ts.isPropertySignature(m) || !m.name || !ts.isIdentifier(m.name) || m.questionToken) continue;
      if (!m.type) continue;
      const t = checker.getTypeAtLocation(m.type);
      const parts = t.isUnion() ? t.types : [t];
      if (parts.some((p) => p.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))) continue;
      if (parts.every((p) => p.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral))) {
        out.push(m.name.text);
      }
    }
    return out;
  };

  for (const stmt of source.statements) {
    if (!ts.isInterfaceDeclaration(stmt)) continue;
    if (!STORE_FOR_TYPE[stmt.name.text] && !NESTED_FOR_TYPE[stmt.name.text]) continue;
    for (const m of stmt.members) {
      if (!ts.isPropertySignature(m) || !m.type || !m.name || !ts.isIdentifier(m.name)) continue;
      let element = null;
      if (ts.isArrayTypeNode(m.type)) element = m.type.elementType;
      else if (ts.isTypeReferenceNode(m.type) && m.type.typeName.getText() === 'Array') {
        element = m.type.typeArguments?.[0] ?? null;
      }
      if (!element || !ts.isTypeReferenceNode(element)) continue;
      const rowType = element.typeName.getText();
      if (mapped.has(rowType) || NESTED_EXEMPT.has(`${stmt.name.text}.${m.name.text}`)) continue;
      const rowDecl = source.statements.find(
        (x) => ts.isInterfaceDeclaration(x) && x.name.text === rowType);
      if (!rowDecl) continue;                      // not declared here; nothing to check
      if (ownStringProps(rowDecl).length === 0) continue;
      report(`RECORD SHAPE: ${stmt.name.text}.${m.name.text} holds ${rowType}[] which carries required strings, and ${rowType} is not in NESTED_FOR_TYPE in scripts/check-shape.mjs -- map it or exempt it with a reason`);
    }
  }

  // Which fields the boundary fills, PER RECORD TYPE -- derived from the map we just
  // parsed, so it stays in step for free rather than being a second hand-written list.
  const shapeByType = new Map();
  for (const [typeName, store] of Object.entries(STORE_FOR_TYPE)) {
    shapeByType.set(typeName, new Set(declared[store]?.strings ?? []));
  }
  for (const [typeName, [store, field]] of Object.entries(NESTED_FOR_TYPE)) {
    shapeByType.set(typeName, new Set(declared[store]?.nested?.[field] ?? []));
  }
  checkNullishOnNormalisedFields(report, shapeByType);
}
