#!/usr/bin/env bash
set -euo pipefail

APPLY=false
if [[ "${1:-}" == "--apply" ]]; then APPLY=true; fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 requis. Installe-le ou lance les modifications à la main." >&2
  exit 1
fi

python3 - "$@" <<'PYTHON_EOF'
import sys, os, shutil, datetime

APPLY = "--apply" in sys.argv
ROOT = os.getcwd()
TS = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

def fail(msg):
    print(f"\n❌ ERREUR: {msg}", file=sys.stderr)
    sys.exit(1)

def apply_patch(path, patches):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        fail(f"{path} introuvable dans {ROOT}")
    with open(full, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    for (label, anchor, expected, replacement) in patches:
        count = content.count(anchor)
        if count != expected:
            fail(f"{path} : ancre [{label}] trouvée {count} fois au lieu de {expected}.\n"
                 f"Le fichier a peut-être déjà été modifié ou diffère de ce qu'on attend.\n"
                 f"--- ANCRE ---\n{anchor[:300]}")

    for (label, anchor, expected, replacement) in patches:
        content = content.replace(anchor, replacement, expected)
        print(f"  ✓ [{label}] appliqué")

    if content == original:
        print(f"[{path}] Déjà à jour, rien à faire.")
        return

    backup = full + ".bak." + TS
    shutil.copy2(full, backup)
    print(f"[{path}] Backup : {backup}")

    if APPLY:
        with open(full, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"[{path}] ✅ Appliqué")
    else:
        print(f"[{path}] 🔍 Dry-run OK (utilise --apply pour appliquer)")

# ─── index.html ───
INDEX_PATCHES = [
    (
        "index.html — insertion radio button mode",
        '''    <div id="outilsForm">
      <div class="ds-field">''',
        1,
        '''    <div id="outilsForm">
      <div class="ds-scope" role="group" aria-label="Mode de transcription">
        <button type="button" class="ds-scope-btn actif" id="outilsModeLienBtn" onclick="outilsChoisirMode('lien')">Lien TikTok</button>
        <button type="button" class="ds-scope-btn" id="outilsModeFichierBtn" onclick="outilsChoisirMode('fichier')">Vidéo de ma galerie</button>
      </div>

      <div id="outilsChampLien" style="margin-top:12px">
        <div class="ds-field" style="margin-top:0">'''
    ),
    (
        "index.html — wrapping input + bloc fichier",
        '''        <input class="ds-input" id="outilsLien" placeholder="Colle le lien TikTok de la vidéo…" autocapitalize="off" autocorrect="off" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();}"/>
      </div>
      <div class="err" id="outilsError" style="display:none;margin-top:14px"></div>''',
        1,
        '''          <input class="ds-input" id="outilsLien" placeholder="Colle le lien TikTok de la vidéo…" autocapitalize="off" autocorrect="off" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();}"/>
        </div>
      </div>

      <div id="outilsChampFichier" style="display:none;margin-top:12px">
        <input type="file" id="outilsFichierInput" accept="video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4" style="display:none" onchange="outilsChargerFichier(this.files)"/>
        <button type="button" class="btn-regenerate" id="outilsFichierBtn" onclick="document.getElementById('outilsFichierInput').click()">📁 Choisir une vidéo (max 100 Mo)</button>
        <div id="outilsFichierInfo" style="display:none;margin-top:10px"></div>
      </div>

      <div class="err" id="outilsError" style="display:none;margin-top:14px"></div>'''
    ),
]

# ─── style.css ───
CSS_PATCHES = [
    (
        "style.css — fix bug .sb-actions-fin (accolade non fermée)",
        '''.sb-actions-fin{
  display:flex;gap:12px;justify-content:center;
  margin-top:20px;padding-top:18px;
  border-top:1px solid var(--border-soft
                           .sb-actions-fin{
  display:flex;gap:12px;justify-content:center;
  margin-top:20px;padding-top:18px;
  border-top:1px solid var(--border-soft);
}''',
        1,
        '''.sb-actions-fin{
  display:flex;gap:12px;justify-content:center;
  margin-top:20px;padding-top:18px;
  border-top:1px solid var(--border-soft);
}'''
    ),
    (
        "style.css — ajout .outils-fichier-info",
        '''[data-install-app].install-cta .ico{width:14px;height:14px}''',
        1,
        '''[data-install-app].install-cta .ico{width:14px;height:14px}

/* ── TRANSCRIPTION FICHIER (mode galerie) ──
   Bloc d'information après sélection d'un fichier : nom + taille, ton
   doré doux, jamais rouge (ce n'est pas une erreur, c'est un état
   "prêt à envoyer"). */
.outils-fichier-info{
  padding:10px 14px;border-radius:10px;background:var(--gold-pale);
  border:1px solid var(--border-soft);font-size:0.85rem;color:var(--gold-light);
  line-height:1.5;
}'''
    ),
]

print("═" * 60)
print("PATCH — TRANSCRIPTION DEPUIS FICHIER (mode galerie)")
print("═" * 60)

print("\n▸ index.html")
apply_patch('index.html', INDEX_PATCHES)

print("\n▸ style.css")
apply_patch('style.css', CSS_PATCHES)

print("\n" + "═" * 60)
if APPLY:
    print("✅ Patch appliqué. Backups créés avec suffixe .bak.<timestamp>")
    print("→ Relance `node --check js/tiktok-outils.js api/transcribe-upload.js`")
    print("→ Relance `node --test tests/transcription-fichier.test.js`")
    print("→ Ouvre l'app, va sur Outils TikTok, clique « Vidéo de ma galerie »")
else:
    print("🔍 DRY-RUN terminé, aucun fichier modifié.")
    print("→ Relance avec --apply pour appliquer :")
    print("   bash patch-transcription-fichier.sh --apply")
print("═" * 60)
PYTHON_EOF
