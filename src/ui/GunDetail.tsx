import { useEffect, useRef, useState } from 'react';
import type { Firearm, MaintenanceEntry, Match, Media, Optic, Reference, Session } from '../lib/types.ts';
import { getAll, getOne, putOne } from '../lib/db.ts';
import { newId } from '../lib/id.ts';
import { prepareUploadBytes } from './shrinkImage.ts';
import { stampNew, stampUpdate } from '../lib/stamps.ts';
import { dryRepsForFirearm, roundsForFirearm } from '../lib/stats.ts';
import { maintLabel, maintenanceStatus } from '../lib/maintenance.ts';
import { isBatteryDue } from '../lib/optics.ts';
import { buildRefLookup, referencesForCategory, toEntry } from '../lib/referenceData.ts';
import { formatDayKey } from '../lib/dates.ts';
import { MarkThumb } from './MarkThumb.tsx';
import { PhotoSheet } from './PhotoSheet.tsx';
import { Sheet } from './Sheet.tsx';
import { GunRemoveSheet } from './GunRemoveSheet.tsx';
import { gunStatus, isActive, statusBadge } from '../lib/gunStatus.ts';

export function GunDetail({ id, onEdit, onBack, onLogMaintenance, onEditMaintenance, onOpenReference, onOpenOptic, onRemoved, refreshKey }: {
  id: string; onEdit: () => void; onBack: () => void;
  onLogMaintenance: () => void; onEditMaintenance: (entryId: string) => void;
  onOpenReference: (refId: string) => void;
  onOpenOptic: (opticId?: string, firearmId?: string) => void;
  onRemoved: (deleted: boolean) => void;
  refreshKey: number;
}) {
  const [gun, setGun] = useState<Firearm | null>(null);
  const [photos, setPhotos] = useState<Media[]>([]);
  const [stats, setStats] = useState({ rounds: 0, sessions: 0, dryReps: 0 });
  const [maintItems, setMaintItems] = useState<ReturnType<typeof maintenanceStatus>>([]);
  const [history, setHistory] = useState<MaintenanceEntry[]>([]);
  const [customRefs, setCustomRefs] = useState<Reference[]>([]);
  const [optics, setOptics] = useState<Optic[]>([]);
  const [viewing, setViewing] = useState<Media | null>(null);
  const [pickingRef, setPickingRef] = useState(false);
  const [localBump, setLocalBump] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [hasHistory, setHasHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [g, firearms, sessions, matches, media, maintenance, refs, allOptics] = await Promise.all([
        getOne<Firearm>('firearms', id),
        getAll<Firearm>('firearms'),
        getAll<Session>('sessions'),
        getAll<Match>('matches'),
        getAll<Media>('media'),
        getAll<MaintenanceEntry>('maintenance'),
        getAll<Reference>('references'),
        getAll<Optic>('optics')
      ]);
      if (!alive || !g) return;
      setGun(g);
      setPhotos(media.filter((m) => m.ownerType === 'firearm' && m.ownerId === id));
      setStats({
        rounds: roundsForFirearm(id, firearms, sessions, matches),
        sessions: sessions.filter((s) => !s.planned && s.guns.some((x) => x.firearmId === id)).length,
        dryReps: dryRepsForFirearm(id, sessions)
      });
      // Whether this gun is named on any session or match — gates permanent delete.
      setHasHistory(
        sessions.some((s) => s.guns.some((x) => x.firearmId === id)) ||
        matches.some((m) => m.firearmId === id)
      );
      setCustomRefs(refs);
      setMaintItems(maintenanceStatus(g, buildRefLookup(refs)(g.referenceId), sessions, maintenance, firearms, new Date()));
      setHistory(maintenance.filter((m) => m.firearmId === id).sort((a, b) => b.date.localeCompare(a.date)));
      setOptics(allOptics.filter((o) => o.firearmId === id));
    })();
    return () => { alive = false; };
  }, [id, refreshKey, localBump]);

  if (!gun) return <div className="screen" />;
  const linkedRef = buildRefLookup(customRefs)(gun.referenceId);
  const customForCategory = customRefs.filter((r) => r.category === gun.category).map(toEntry);

  async function addPhotos(list: FileList | null) {
    if (!list || !gun) return;
    const now = Date.now();
    let seq = photos.length;
    for (const file of Array.from(list)) {
      seq += 1;
      const { data: buf, mime } = await prepareUploadBytes(file);
      await putOne('media', stampNew({
        ownerType: 'firearm' as const, ownerId: id,
        kind: file.type.startsWith('video') ? 'video' as const : 'image' as const,
        name: `${gun.name} — photo ${seq}`,
        annotations: [], mime, data: buf
      }, newId('md'), now));
    }
    setLocalBump((b) => b + 1);
  }

  async function linkReference(refId: string | null) {
    if (!gun) return;
    await putOne('firearms', stampUpdate({ ...gun, referenceId: refId }, Date.now()));
    setPickingRef(false);
    setLocalBump((b) => b + 1);
  }

  // Bring a retired / no-longer-owned gun back to active.
  async function unretire() {
    if (!gun) return;
    await putOne('firearms', stampUpdate({ ...gun, status: 'active', statusReason: '', statusDate: '' }, Date.now()));
    onRemoved(false);
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button className="back-btn" onClick={onBack}>‹ Back</button>
        <button className="navbar-action" onClick={onEdit}>Edit</button>
      </div>
      <h1 className="large-title">{gun.name}</h1>

      {!isActive(gun) && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="row">
            <span className="label">Status
              <div className="row-sub">
                {gunStatus(gun) === 'retired'
                  ? 'Retired — still yours, just benched.'
                  : `No longer owned${gun.statusReason ? ` — ${gun.statusReason}` : ''}.`}
                {gun.statusDate ? ` (${formatDayKey(gun.statusDate)})` : ''}
              </div>
            </span>
            <span className={`badge ${gunStatus(gun) === 'retired' ? 'warn-badge' : 'bad'}`}>{statusBadge(gun)}</span>
          </div>
          <button className="button secondary" style={{ marginTop: 10 }} onClick={() => void unretire()}>
            Return to active
          </button>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat"><div className="num">{stats.rounds.toLocaleString()}</div><div className="cap">Lifetime rounds (live fire)</div></div>
        <div className="stat"><div className="num">{stats.sessions}</div><div className="cap">Sessions</div></div>
        {stats.dryReps > 0 && (
          <div className="stat"><div className="num">{stats.dryReps.toLocaleString()}</div><div className="cap">Dry-fire reps</div></div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Upkeep</h2>
        {maintItems.map((it) => (
          <div className="row" key={it.type}>
            <span className="label">
              {it.label}
              <div className="row-sub">{it.detail}</div>
            </span>
            <span className={`badge ${it.level === 'due' ? 'bad' : it.level === 'warn' ? 'warn-badge' : 'ok'}`}>
              {it.level === 'due' ? 'Due' : it.level === 'warn' ? 'Soon' : it.level === 'info' ? 'Note' : 'OK'}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 10 }}>
          <button className="button secondary" onClick={onLogMaintenance}>+ Log Work</button>
        </div>
        {history.length > 0 && (
          <>
            <h2 style={{ marginTop: 16 }}>Recent Work</h2>
            {history.slice(0, 5).map((m) => (
              <button className="row-tap" key={m.id} onClick={() => onEditMaintenance(m.id)}>
                <span className="label">
                  {maintLabel(m.type)}
                  {(m.partsReplaced || m.notes) && (
                    <div className="row-sub">{[m.partsReplaced, m.notes].filter(Boolean).join(' · ')}</div>
                  )}
                </span>
                <span className="value">{formatDayKey(m.date)} ›</span>
              </button>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <h2>Maintenance Guide</h2>
        {linkedRef ? (
          <p className="report-note" style={{ marginBottom: 10 }}>
            Linked to <strong>{linkedRef.name}</strong> — its schedule fills in any blanks above.
          </p>
        ) : (
          <p className="report-note" style={{ marginBottom: 10 }}>
            No maintenance guide linked. Link the maker's guide and its care schedule becomes this gun's default.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {linkedRef && (
            <button className="button secondary" style={{ flex: 1 }}
              onClick={() => onOpenReference(linkedRef.id)}>View Guide</button>
          )}
          <button className="button secondary" style={{ flex: 1 }} onClick={() => setPickingRef(true)}>
            {linkedRef ? 'Change Guide' : 'Link Maintenance Guide'}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Optics</h2>
        {optics.length === 0 && (
          <p className="report-note" style={{ marginBottom: 10 }}>No optic linked to this gun yet.</p>
        )}
        {optics.map((op) => {
          const due = isBatteryDue(op.batteryLog, new Date());
          return (
            <button className="row-tap" key={op.id} onClick={() => onOpenOptic(op.id, op.firearmId)}>
              <span className="label">
                {[op.make, op.model].filter(Boolean).join(' ') || 'Unnamed optic'}
                <div className="row-sub">{due ? 'Battery due' : 'Active'}</div>
              </span>
              <span className="value">›</span>
            </button>
          );
        })}
        <button className="button secondary" style={{ marginTop: 10 }} onClick={() => onOpenOptic(undefined, gun.id)}>
          + Add Optic
        </button>
      </div>

      <div className="card">
        <h2>Details</h2>
        <div className="row"><span className="label">Made by</span><span className="value">{gun.manufacturer || '—'}</span></div>
        <div className="row"><span className="label">Model</span><span className="value">{gun.model || '—'}</span></div>
        <div className="row"><span className="label">Type</span><span className="value">{gun.category}</span></div>
        <div className="row"><span className="label">Caliber</span><span className="value">{gun.caliber || '—'}</span></div>
        <div className="row"><span className="label">Serial</span><span className="value">{gun.serialNumber || '—'}</span></div>
        {gun.dateAcquired && <div className="row"><span className="label">Acquired</span><span className="value">{gun.dateAcquired}</span></div>}
        {gun.startingRoundCount > 0 && <div className="row"><span className="label">Starting round count</span><span className="value">{gun.startingRoundCount.toLocaleString()}</span></div>}
      </div>

      <div className="card">
        <h2>Photos</h2>
        {photos.length > 0 && (
          <>
            <p className="report-note" style={{ marginBottom: 8 }}>Tap one to name it, jot notes, or remove it.</p>
            <div className="photo-grid" style={{ marginBottom: 12 }}>
              {photos.map((m) => (
                <div className="thumb-wrap" key={m.id}>
                  <button className="thumb-tap" onClick={() => setViewing(m)} aria-label={m.name}>
                    <MarkThumb media={m} />
                  </button>
                  <span className="thumb-caption">{m.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }}
          onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }} />
        <button className="button secondary" onClick={() => fileRef.current?.click()}>+ Add Photos</button>
      </div>

      {gun.notes && (
        <div className="card">
          <h2>Notes</h2>
          <p className="note-text">{gun.notes}</p>
        </div>
      )}

      {isActive(gun) && (
        <button className="button secondary" style={{ marginTop: 16 }} onClick={() => setRemoving(true)}>
          Retire or remove this gun…
        </button>
      )}

      {removing && (
        <GunRemoveSheet gun={gun} hasHistory={hasHistory}
          onClose={() => setRemoving(false)}
          onDone={(deleted) => { setRemoving(false); onRemoved(deleted); }} />
      )}

      {viewing && (
        <PhotoSheet media={viewing} onClose={() => setViewing(null)}
          onChanged={() => setLocalBump((b) => b + 1)} />
      )}
      {pickingRef && (
        <Sheet title="Link Maintenance Guide" onClose={() => setPickingRef(false)}>
          <p className="report-note" style={{ marginBottom: 8 }}>
            Guides for {gun.category.toLowerCase()}s:
          </p>
          {[...customForCategory, ...referencesForCategory(gun.category)].map((r) => (
            <button key={r.id} className="drill-pick-row" onClick={() => void linkReference(r.id)}>
              <strong>{r.name}{r.id.startsWith('refx') ? ' (yours)' : ''}</strong>
              <span>Deep clean every {r.maintenance.deepCleanRounds.toLocaleString()} rounds{r.maintenance.recoilSpringRounds ? ` · spring every ${r.maintenance.recoilSpringRounds.toLocaleString()}` : ''}</span>
            </button>
          ))}
          {customForCategory.length + referencesForCategory(gun.category).length === 0 && (
            <p className="report-note">No guides for this gun type yet — create one from the Reference screen.</p>
          )}
          {gun.referenceId && (
            <button className="drill-pick-row" onClick={() => void linkReference(null)}>
              <strong>Remove the link</strong>
              <span>Go back to the standard schedule</span>
            </button>
          )}
        </Sheet>
      )}
    </div>
  );
}
