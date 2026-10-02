import { AccountSync } from "../components/AccountSync";
import { GlassSwitch } from "../components/MobileGlass";
import { useState, useEffect } from "react";
import {
  Download,
  Upload,
  Plus,
  ShieldCheck,
  Monitor,
  Sun,
  Moon,
} from "lucide-react";
import { useSettingsStore } from "../../store/settingsStore";
import { useSongStore } from "../../store/songStore";
import { TuningSchema, type Tuning } from "../../schema/song.v1";
import { db } from "../../persistence/dexie";
import { exportBackup, importBackup } from "../../io/backup";
import { downloadFile } from "../../io/json";
import {
  PageTitle,
  Segments,
  Modal,
  ErrorNotice,
  useToast,
} from "../components/Common";
export function Settings() {
  const { settings, update, tunings, addTuning, error } = useSettingsStore();
  const [custom, setCustom] = useState(false),
    [label, setLabel] = useState(""),
    [midi, setMidi] = useState("64, 59, 55, 50, 45, 40"),
    [localError, setLocalError] = useState(""),
    [quarantine, setQuarantine] = useState<{ id: string; error: string }[]>([]);
  const toast = useToast();
  useEffect(() => {
    db.quarantine
      .toArray()
      .then(setQuarantine)
      .catch((e) => setLocalError(String(e)));
  }, []);
  return (
    <>
      <PageTitle
        eyebrow="FEELS LIKE YOURS"
        title="Settings"
        description="A few small things that make playing more comfortable."
      />
      <ErrorNotice error={error || localError} />
      <div className="settings-grid">
        <section className="card settings-section">
          <h2>Make yourself at home</h2>
          <p>Choose the view that suits your space.</p>
          <label>Appearance</label>
          <div className="theme-options">
            {[
              { id: "system", icon: Monitor, label: "System" },
              { id: "light", icon: Sun, label: "Light" },
              { id: "dark", icon: Moon, label: "Dark" },
            ].map((t) => (
              <button
                key={t.id}
                aria-pressed={settings.theme === t.id}
                className={settings.theme === t.id ? "selected" : ""}
                onClick={() =>
                  void update({ theme: t.id as typeof settings.theme })
                }
              >
                <t.icon size={24} />
                {t.label}
              </button>
            ))}
          </div>
          <label>
            Interface size · {Math.round(settings.interfaceScale * 100)}%
            <input
              type="range"
              min="0.85"
              max="1.2"
              step="0.05"
              value={settings.interfaceScale}
              onChange={(e) =>
                void update({ interfaceScale: Number(e.target.value) })
              }
            />
            <small className="muted">
              Make text and common controls more compact or easier to read.
            </small>
          </label>
          <label className="switch-row">
            <span>
              <strong>Left-handed diagrams</strong>
              <small>
                Mirrors chord boxes and fretboard. Tab stays in standard order.
              </small>
            </span>
            <GlassSwitch
              checked={settings.leftHanded}
              onChange={(e) => void update({ leftHanded: e.target.checked })}
            />
          </label>
          <label>
            Default notation view
            <select
              value={settings.defaultView}
              onChange={(e) =>
                void update({
                  defaultView: e.target.value as typeof settings.defaultView,
                })
              }
            >
              <option value="chord">Chords</option>
              <option value="tab">Tab</option>
              <option value="combined">Combined</option>
            </select>
          </label>
          <label>Chord names</label>
          <Segments
            label="Default chord name mode"
            value={settings.nameDisplay}
            options={[
              { value: "sounding", label: "Sounding" },
              { value: "shape", label: "Shape" },
            ]}
            onChange={(v) => void update({ nameDisplay: v })}
          />
        </section>
        <section className="card settings-section">
          <h2>Find your rhythm</h2>
          <p>Practice defaults, ready for your next session.</p>
          <label>
            A4 reference · {settings.a4Hz} Hz
            <input
              type="range"
              min="432"
              max="446"
              step="1"
              value={settings.a4Hz}
              onChange={(e) => void update({ a4Hz: Number(e.target.value) })}
            />
          </label>
          <label>
            Metronome sound
            <select
              value={settings.metronome.sound}
              onChange={(e) =>
                void update({
                  metronome: {
                    ...settings.metronome,
                    sound: e.target.value as typeof settings.metronome.sound,
                  },
                })
              }
            >
              <option value="click">Click</option>
              <option value="wood">Wood</option>
              <option value="beep">Beep</option>
            </select>
          </label>
          <label>
            Count-in
            <select
              value={settings.metronome.countIn}
              onChange={(e) =>
                void update({
                  metronome: {
                    ...settings.metronome,
                    countIn: Number(e.target.value) as 0 | 1 | 2,
                  },
                })
              }
            >
              <option value="0">None</option>
              <option value="1">1 measure</option>
              <option value="2">2 measures</option>
            </select>
          </label>
          {(["accentDownbeat", "subdivisionClicks"] as const).map((k) => (
            <label className="switch-row" key={k}>
              <span>
                {k === "accentDownbeat"
                  ? "Accent the downbeat"
                  : "Play subdivision clicks"}
              </span>
              <GlassSwitch
                checked={settings.metronome[k]}
                onChange={(e) =>
                  void update({
                    metronome: { ...settings.metronome, [k]: e.target.checked },
                  })
                }
              />
            </label>
          ))}
        </section>
        <section className="card settings-section">
          <div className="section-title">
            <h2>Your tunings</h2>
            <button onClick={() => setCustom(true)}>
              <Plus size={16} />
              Custom tuning
            </button>
          </div>
          <p>
            Six strings. Plenty of possibilities. Notes below run high to low.
          </p>
          <div className="tuning-list">
            {tunings.map((t) => (
              <div key={t.id}>
                <strong>{t.label}</strong>
                <span>{t.midi.join(" · ")}</span>
                <small>{t.builtIn ? "Built-in" : "Custom"}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="card settings-section">
          <h2>Keep your music close</h2>
          <p>
            Back up your songs, setlists, custom tunings, settings and practice
            history. Reference recordings stay on this device.
          </p>
          <div className="button-row">
            <button
              onClick={() => {
                exportBackup()
                  .then((b) =>
                    downloadFile(
                      JSON.stringify(b, null, 2),
                      "fretshift-backup.json",
                    ),
                  )
                  .catch((e) => setLocalError(String(e)));
              }}
            >
              <Download size={17} />
              Export library backup
            </button>
            <label className="button file-button">
              <Upload size={17} />
              Import backup
              <input
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    await importBackup(JSON.parse(await f.text()));
                    await useSongStore.getState().initialize();
                    await useSettingsStore.getState().init();
                    toast(
                      "Backup imported. Matching IDs were updated; other songs were kept.",
                    );
                  } catch (err) {
                    setLocalError(String(err));
                  }
                }}
              />
            </label>
          </div>
          <p className="small muted">
            Import merges by record ID. Export a backup first to keep an earlier
            revision.
          </p>
          <div className="privacy">
            <ShieldCheck size={22} />
            <div>
              <strong>Private by design</strong>
              <p>
                Microphone, reference recordings and audio analysis stay on
                device. Photos and scanned pages use the vision service only
                after you choose to upload. Practice history belongs to your
                account.
              </p>
            </div>
          </div>
        </section>
        <AccountSync />
        {quarantine.length > 0 && (
          <section className="card settings-section">
            <h2>Records needing attention</h2>
            {quarantine.map((q) => (
              <p key={q.id} className="error-notice">
                {q.id}: {q.error}
              </p>
            ))}
            <p>
              Original records are retained in the quarantine store. Correct
              their schema or restore a valid backup.
            </p>
          </section>
        )}
      </div>
      {custom && (
        <Modal title="A tuning of your own" onClose={() => setCustom(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const values = midi.split(",").map((s) => Number(s.trim()));
                if (values.length !== 6)
                  throw new Error(
                    "Enter exactly six MIDI pitches, high string first.",
                  );
                const t = TuningSchema.parse({
                  id: crypto.randomUUID(),
                  label: label.trim(),
                  midi: values as Tuning["midi"],
                  builtIn: false,
                });
                await addTuning(t);
                setCustom(false);
                toast("Custom tuning saved.");
                setLocalError("");
              } catch (err) {
                setLocalError(String(err));
              }
            }}
          >
            <label>
              Name
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="My open tuning"
                required
              />
            </label>
            <label>
              Six MIDI notes, high string to low
              <input value={midi} onChange={(e) => setMidi(e.target.value)} />
            </label>
            <p className="muted">
              Standard is E4=64, B3=59, G3=55, D3=50, A2=45, E2=40.
            </p>
            <ErrorNotice error={localError} />
            <button className="primary" type="submit">
              Save tuning
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
