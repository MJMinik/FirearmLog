// Reference (spec §9): built-in manufacturer guides PLUS the user's own.
// Custom guides live in the database, sync in the .flog file, and appear in
// the gun link picker right beside the built-ins.
import { useEffect, useState } from 'react';
import type { GunCategory, Reference } from '../lib/types.ts';
import { GUN_CATEGORIES } from '../lib/types.ts';
import { getAll, getOne, putOne, deleteOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import type { ReferenceEntry } from '../lib/referenceData.ts';
import { REFERENCES, getReference, isCustomRefId, toEntry } from '../lib/referenceData.ts';
import type { Firearm } from '../lib/types.ts';
import { ConfirmSheet } from './Sheet.tsx';
import { InfoTip } from './InfoTip.tsx';
import { FormProblem } from './FormProblem.tsx';

export function ReferenceList({ refreshKey, onBack, openDetail, openForm }: {
  refreshKey: number; onBack: () => void;
  openDetail: (id: string) => void; openForm: () => void;
}) {
  const [custom, setCustom] = useState<Reference[]>([]);
  useEffect(() => {
    let alive = true;
    void getAll<Reference>('references').then((r) => {
      if (alive) setCustom(r.sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => { alive = false; };
  }, [refreshKey]);

  const groups: GunCategory[] = ['Pistol', 'Rifle', 'Shotgun'];
  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <span />
      </div>
      <h1 className="large-title">Reference <InfoTip title="Reference">Manufacturer care guides. Link one to a gun to set its default maintenance schedule. Don't see your make, or want your own steps and schedule? Tap "+ Create Your Own Guide" and link it to a gun.</InfoTip></h1>
      <p className="report-note" style={{ marginBottom: 12 }}>
        Care guides by manufacturer. Link one to a gun (on the gun's page) and that
        guide's schedule becomes the gun's default.
      </p>
      <button className="button" onClick={openForm}>+ Create Your Own Guide</button>
      {custom.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Your Guides</h2>
          {custom.map((r) => (
            <button className="row-tap" key={r.id} onClick={() => openDetail(r.id)}>
              <span className="label">{r.name}<div className="row-sub">{r.category}</div></span>
              <span className="value">›</span>
            </button>
          ))}
        </div>
      )}
      {groups.map((cat) => (
        <div className="card" key={cat} style={cat === 'Pistol' && custom.length === 0 ? { marginTop: 16 } : undefined}>
          <h2>{cat}s</h2>
          {REFERENCES.filter((r) => r.category === cat).map((r) => (
            <button className="row-tap" key={r.id} onClick={() => openDetail(r.id)}>
              <span className="label">{r.name}</span>
              <span className="value">›</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function ReferenceDetail({ id, onBack, onEdit, onCopy, onDeleted, refreshKey }: {
  id: string; onBack: () => void;
  onEdit: () => void; onCopy: () => void; onDeleted: () => void;
  refreshKey: number;
}) {
  const custom = isCustomRefId(id);
  const [entry, setEntry] = useState<ReferenceEntry | undefined>(custom ? undefined : getReference(id));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!custom) { setEntry(getReference(id)); return; }
    let alive = true;
    void getOne<Reference>('references', id).then((r) => {
      if (alive) setEntry(r ? toEntry(r) : undefined);
    });
    return () => { alive = false; };
  }, [id, custom, refreshKey]);

  async function reallyDelete() {
    // Unlink any guns pointing at this guide, then remove it.
    const guns = await getAll<Firearm>('firearms');
    for (const g of guns) {
      if (g.referenceId === id) {
        await putOne('firearms', stampUpdate({ ...g, referenceId: null }, Date.now()));
      }
    }
    await deleteOne('references', id);
    onDeleted();
  }

  if (!entry) return <div className="screen"><div className="navbar"><button className="back-btn" onClick={onBack}>‹ Back</button><span /></div></div>;

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        {custom ? <button className="navbar-action" onClick={onEdit}>Edit</button> : <span />}
      </div>
      <h1 className="large-title">{entry.name}</h1>

      <div className="card">
        <h2>Suggested Schedule</h2>
        <div className="row">
          <span className="label">Deep clean</span>
          <span className="value">every {entry.maintenance.deepCleanRounds.toLocaleString()} rounds</span>
        </div>
        {entry.maintenance.recoilSpringRounds && (
          <div className="row">
            <span className="label">Recoil spring</span>
            <span className="value">every {entry.maintenance.recoilSpringRounds.toLocaleString()} rounds</span>
          </div>
        )}
        <div className="row">
          <span className="label">Field strip</span>
          <span className="value">after live sessions</span>
        </div>
        <div className="row">
          <span className="label">Inspection</span>
          <span className="value">yearly</span>
        </div>
        {!custom && (
          <p className="report-note" style={{ marginTop: 8 }}>
            {entry.maintenance.note} These are common starting points — your owner's manual wins.
          </p>
        )}
      </div>

      {entry.checklist.length > 0 && (
        <div className="card">
          <h2>Cleaning Checklist</h2>
          <ol className="sync-steps">
            {entry.checklist.map((c, i) => <li key={i}>{c}</li>)}
          </ol>
        </div>
      )}

      {entry.guidance && (
        <div className="card">
          <h2>Care Notes</h2>
          <p className="note-text">{entry.guidance}</p>
        </div>
      )}

      {entry.links.length > 0 && (
        <div className="card">
          <h2>Links</h2>
          {entry.links.map((l) => (
            <a className="row-tap" key={l.url} href={l.url} target="_blank" rel="noreferrer"
              style={{ textDecoration: 'none' }}>
              <span className="label" style={{ color: 'var(--accent)' }}>{l.label}</span>
              <span className="value">↗</span>
            </a>
          ))}
        </div>
      )}

      {custom ? (
        <button className="button danger" onClick={() => setConfirming(true)}>Delete This Guide</button>
      ) : (
        <button className="button secondary" onClick={onCopy}>Copy &amp; Customize This Guide</button>
      )}

      {confirming && (
        <ConfirmSheet
          title="Delete this guide?"
          message="Any gun linked to it goes back to the standard schedule. There's no undo."
          confirmLabel="Delete Guide"
          onConfirm={() => void reallyDelete()}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

export function ReferenceForm({ id, copyFrom, onSaved, onCancel }: {
  id?: string; copyFrom?: string;
  onSaved: (refId: string) => void; onCancel: () => void;
}) {
  const [original, setOriginal] = useState<Reference | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<GunCategory>('Pistol');
  const [deepClean, setDeepClean] = useState('5000');
  const [recoilSpring, setRecoilSpring] = useState('');
  const [checklist, setChecklist] = useState('');
  const [guidance, setGuidance] = useState('');
  const [links, setLinks] = useState('');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let alive = true;
    if (id !== undefined) {
      void getOne<Reference>('references', id).then((r) => {
        if (!alive || !r) return;
        setOriginal(r);
        setName(r.name); setCategory(r.category);
        setDeepClean(String(r.deepCleanRounds));
        setRecoilSpring(r.recoilSpringRounds ? String(r.recoilSpringRounds) : '');
        setChecklist(r.checklist.join('\n'));
        setGuidance(r.guidance);
        setLinks(r.links.map((l) => l.url).join('\n'));
      });
    } else if (copyFrom) {
      const src = getReference(copyFrom);
      if (src) {
        setName(`${src.name} (my copy)`); setCategory(src.category);
        setDeepClean(String(src.maintenance.deepCleanRounds));
        setRecoilSpring(src.maintenance.recoilSpringRounds ? String(src.maintenance.recoilSpringRounds) : '');
        setChecklist(src.checklist.join('\n'));
        setGuidance(src.guidance);
        setLinks(src.links.map((l) => l.url).join('\n'));
      }
    }
    return () => { alive = false; };
  }, [id, copyFrom]);

  function linkLabel(url: string): string {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
  }

  async function save() {
    if (!name.trim()) { setProblem('Give the guide a name (the maker or the gun).'); return; }
    const dc = Number(deepClean);
    if (!(dc > 0)) { setProblem('Deep clean needs a round count, like 5000.'); return; }
    const rs = recoilSpring.trim() === '' ? null : Number(recoilSpring);
    if (rs !== null && !(rs > 0)) { setProblem('Recoil spring needs a plain round count (or leave it blank).'); return; }
    const linkList = links.split('\n').map((l) => l.trim()).filter(Boolean)
      .map((url) => ({ label: linkLabel(url), url: url.startsWith('http') ? url : `https://${url}` }));
    const fields = {
      name: name.trim(), category,
      deepCleanRounds: dc, recoilSpringRounds: rs,
      checklist: checklist.split('\n').map((c) => c.trim()).filter(Boolean),
      guidance: guidance.trim(),
      links: linkList
    };
    if (original) {
      const updated = stampUpdate({ ...original, ...fields }, Date.now());
      await putOne('references', updated);
      onSaved(updated.id);
    } else {
      const created: Reference = stampNew(fields, newId('refx'), Date.now());
      await putOne('references', created);
      onSaved(created.id);
    }
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onCancel}>‹ Cancel</button>
        <button className="navbar-action" onClick={() => void save()}>Save</button>
      </div>
      <h1 className="large-title">{original ? 'Edit Guide' : 'New Guide'}</h1>
      <FormProblem problem={problem} />

      <div className="card">
        <label className="field">Guide name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wilson Combat, Grandpa's 1911…" />
        </label>
        <label className="field">Gun type
          <select value={category} onChange={(e) => setCategory(e.target.value as GunCategory)}>
            {GUN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="field">Deep clean every … rounds
          <input type="number" inputMode="numeric" min="1" value={deepClean} onChange={(e) => setDeepClean(e.target.value)} />
        </label>
        <label className="field">Recoil spring every … rounds (blank if not tracked)
          <input type="number" inputMode="numeric" min="1" value={recoilSpring} onChange={(e) => setRecoilSpring(e.target.value)} />
        </label>
        <label className="field">Cleaning checklist (one step per line)
          <textarea rows={5} value={checklist} onChange={(e) => setChecklist(e.target.value)}
            placeholder={'Field strip and wipe the rails\nOil the barrel and slide\nCheck screws'} />
        </label>
        <label className="field">Care notes
          <textarea rows={4} value={guidance} onChange={(e) => setGuidance(e.target.value)} />
        </label>
        <label className="field">Web links (one address per line)
          <textarea rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://example.com/manual" />
        </label>
      </div>
      <button className="button" onClick={() => void save()}>{original ? 'Save Changes' : 'Create Guide'}</button>
    </div>
  );
}
