// (4) THE READ-BOUNDARY KEEPER (session 107, 6 Aug 2026).
//
// `src/lib/recordShape.ts` fills in any field the model declares as a required
// string but the stored data does not actually carry — the fix for the class of
// crash where a match with no `date` took the whole Compete tab down. That map is
// written by hand, and a hand-written map of the model goes stale the first time
// somebody adds a field. Silently, which is the whole problem: the new field is
// simply not filled in, and the crash returns wearing the next field's name.
//
// So the map is held to `types.ts` here. Add a required string to an interface
// without listing it and this fails, naming the field and the file to edit.
//
// WHY THIS USES THE TYPESCRIPT COMPILER AND NOT A REGEX. The first version parsed
// `types.ts` one line at a time. A cold audit then wrote nine perfectly ordinary
// declarations it did not see — a comma terminator instead of a semicolon, a
// declaration split over two lines, `readonly`, `Array<{…}>` instead of `{…}[]`,
// a field inherited from a base interface, a union alias of a union alias, an
// alias imported from another module, a store declared as a type intersection,
// and an index signature. Every one of them would have gone unnormalised AND
// unreported. A keeper with nine known holes is worse than no keeper, because it
// is trusted. TypeScript's own parser has none of those holes, it is already a
// dependency of this repo, and it is what `npm run build` uses to decide whether
// the code is valid at all. Using anything else here is guessing at a language we
// already have a parser for.
//
// WHAT THIS STILL DOES NOT SEE, stated rather than implied. A record interface
// rewritten as a TYPE ALIAS (`export type Classifier = BaseRecord & { … }`) is
// skipped, because the walk below visits interface declarations only — measured
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

// `id` is excluded everywhere by design — it is IndexedDB's key path, so a record
// without one could never have been stored. recordShape.ts says why in full.
const NEVER_NORMALISED = new Set(['id']);

// Nested arrays deliberately left out of the shape map, each with its reason.
// `sessions.guns.magOverrides` sits TWO levels deep (session -> gun -> override),
// which StoreShape cannot express, and its only string, `magId`, is used solely as
// an object key and in equality tests — never as the receiver of a string method,
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
 * `.<field> ??` and returned 61 hits, nearly all of them wrong — record fields are
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
   * The record type behind an expression — but ONLY when that expression cannot
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
        // `?? ''` on a normalised field is HARMLESS — redundant, but it produces
        // exactly the value the boundary already guarantees, so nothing is hidden
        // and nothing behaves unexpectedly. The hazard is a fallback that is
        // SOMETHING ELSE: `?? MATCH_TYPES[0]`, `?? 'Match'`. Those read as live
        // guards, never fire, and the code behaves as if the author's intent had
        // been deleted — which is precisely what happened to the Edit Match picker.
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
  // strictNullChecks MUST be on. Without it TypeScript collapses `string | null`
  // to `string`, and this check then demands that `serialNumber`, `referenceId`
  // and `sessionId` be normalised — the exact fields where `null` means "not
  // recorded" and `''` would be a different fact. Caught on the first run of this
  // rewrite, which is the argument for running a new check before trusting it.
  const program = ts.createProgram([TYPES_FILE], {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    strict: true, strictNullChecks: true, skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(TYPES_FILE);
  if (!source) { report(`RECORD SHAPE: cannot read ${TYPES_FILE}`); return; }

  // A CHECKER MUST NOT SPEAK WHEN IT CANNOT SEE. With a syntax error mid-edit in
  // types.ts the compiler still hands back a partial tree, and this check then
  // reported eight confident instructions to DELETE correct entries. Someone
  // following them would have removed real normalisation because of a stray
  // bracket. Refuse instead: say what is wrong and let `tsc` do the explaining.
  const syntax = program.getSyntacticDiagnostics(source);
  if (syntax.length > 0) {
    report(`RECORD SHAPE: ${TYPES_FILE} does not parse (${syntax.length} syntax error(s)) — fix it first; this check cannot read a broken model`);
    return;
  }
  // An EMPTY or record-free types.ts would otherwise pass in silence, which reads
  // as "the map matches the model" when it means "there is no model".
  if (!source.statements.some((s) => ts.isInterfaceDeclaration(s) && STORE_FOR_TYPE[s.name.text])) {
    report(`RECORD SHAPE: ${TYPES_FILE} declares none of the record interfaces — refusing to report clean`);
    return;
  }

  /** Is this type node a required string as far as this defect is concerned? */
  const isStringy = (node) => {
    if (!node) return false;
    const t = checker.getTypeAtLocation(node);
    // `string`, a string literal, or a union of them — but NOT a union that
    // includes null or undefined, where the absence is meaningful and must stay.
    const parts = t.isUnion() ? t.types : [t];
    if (parts.some((p) => p.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))) return false;
    return parts.every((p) => p.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral));
  };

  /** The required string-valued property names of one interface, own members only. */
  const stringProps = (decl) => decl.members
    .filter((m) => ts.isPropertySignature(m) && m.name && ts.isIdentifier(m.name))
    .filter((m) => !m.questionToken)
    .filter((m) => isStringy(m.type))
    .map((m) => m.name.text)
    .filter((n) => !NEVER_NORMALISED.has(n));

  /** Inherited members too — a required string added to a base interface reaches every store. */
  const inheritedStringProps = (decl) => {
    const out = [];
    for (const clause of decl.heritageClauses ?? []) {
      for (const t of clause.types) {
        const sym = checker.getSymbolAtLocation(t.expression);
        for (const d of sym?.declarations ?? []) {
          if (ts.isInterfaceDeclaration(d)) out.push(...stringProps(d), ...inheritedStringProps(d));
        }
      }
    }
    return out;
  };

  /** Nested arrays declared inline: `foo: { bar: string }[]` or `Array<{ bar: string }>`. */
  const inlineNested = (decl) => {
    const out = [];
    for (const m of decl.members) {
      if (!ts.isPropertySignature(m) || !m.name || !ts.isIdentifier(m.name) || !m.type) continue;
      let element = null;
      if (ts.isArrayTypeNode(m.type)) element = m.type.elementType;
      else if (ts.isTypeReferenceNode(m.type) && m.type.typeName.getText() === 'Array') {
        element = m.type.typeArguments?.[0] ?? null;
      }
      if (!element || !ts.isTypeLiteralNode(element)) continue;
      const fields = element.members
        .filter((x) => ts.isPropertySignature(x) && x.name && ts.isIdentifier(x.name))
        .filter((x) => !x.questionToken && isStringy(x.type))
        .map((x) => x.name.text)
        .filter((n) => !NEVER_NORMALISED.has(n));
      if (fields.length) out.push({ field: m.name.text, fields });
    }
    return out;
  };

  // What recordShape.ts declares. Parsed with the compiler as well, so the map is
  // read as source rather than pattern-matched.
  let shapeText;
  try {
    shapeText = readFileSync(SHAPE_FILE, 'utf8');
  } catch {
    // A missing file used to throw ENOENT and block the build with a stack trace
    // instead of a sentence. A checker that crashes is a checker nobody can act on.
    report(`RECORD SHAPE: ${SHAPE_FILE} is missing — the read boundary's shape map is gone`);
    return;
  }
  const shapeSource = ts.createSourceFile(SHAPE_FILE, shapeText, ts.ScriptTarget.ES2022, true);
  const declared = {};
  const literalStrings = (node) => node.elements.map((e) => (ts.isStringLiteral(e) ? e.text : null))
    .filter((x) => x !== null);
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'RECORD_SHAPE') {
      let init = node.initializer;
      while (init && (ts.isAsExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
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

  for (const stmt of source.statements) {
    if (!ts.isInterfaceDeclaration(stmt)) continue;
    const typeName = stmt.name.text;
    const store = STORE_FOR_TYPE[typeName];
    const nested = NESTED_FOR_TYPE[typeName];
    if (!store && !nested) continue;
    const where = store ?? `${nested[0]}.${nested[1]}`;

    const expected = [...new Set([...stringProps(stmt), ...inheritedStringProps(stmt)])];
    const entry = declared[store ?? nested[0]];
    const list = store ? entry?.strings : entry?.nested?.[nested[1]];
    if (!list) {
      report(`RECORD SHAPE: no entry for ${where} (${typeName}) in ${SHAPE_FILE}`);
      continue;
    }
    for (const f of expected) {
      if (!list.includes(f)) {
        report(`RECORD SHAPE: ${typeName}.${f} is a required string but is not normalised — add it to RECORD_SHAPE.${where} in ${SHAPE_FILE}`);
      }
    }
    for (const f of list) {
      if (!expected.includes(f)) {
        report(`RECORD SHAPE: RECORD_SHAPE.${where} lists '${f}', which ${typeName} does not declare as a required string — remove it`);
      }
    }

    for (const { field, fields } of inlineNested(stmt)) {
      if (NESTED_EXEMPT.has(`${typeName}.${field}`)) continue;
      if (nested) {
        report(`RECORD SHAPE: ${typeName}.${field} is a nested array two levels deep carrying required strings (${fields.join(', ')}) — flatten it, or add '${typeName}.${field}' to NESTED_EXEMPT with the reason`);
        continue;
      }
      const declaredInline = entry?.nested?.[field];
      for (const f of fields) {
        if (!declaredInline?.includes(f)) {
          report(`RECORD SHAPE: ${typeName}.${field}[].${f} is a required string but is not normalised — add it to RECORD_SHAPE.${store}.nested.${field} in ${SHAPE_FILE}`);
        }
      }
    }
  }

  // A named nested row type that nobody mapped is invisible to everything above,
  // which is how three inline arrays went uncovered. Catch the shape itself:
  // any interface referenced as an array element by a mapped store must be
  // declared in NESTED_FOR_TYPE.
  const mapped = new Set([...Object.keys(STORE_FOR_TYPE), ...Object.keys(NESTED_FOR_TYPE)]);
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
      if (stringProps(rowDecl).length === 0) continue;
      report(`RECORD SHAPE: ${stmt.name.text}.${m.name.text} holds ${rowType}[] which carries required strings, and ${rowType} is not in NESTED_FOR_TYPE in scripts/check-shape.mjs — map it or exempt it with a reason`);
    }
  }

  // Which fields the boundary fills, PER RECORD TYPE — derived from the map we just
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
