/* ═══════════════════════════════════════════════════════════════════
   I18N — the active language and every interface string.

   Strings live in strings.json with both languages side by side, so a
   missing or stale key is obvious at a glance. Lookup is by dot path
   ("ui.task.confirm"); if a key is absent in the active language it
   falls back to the other one rather than rendering blank.

   The language is study data: Store records it on the session and logs
   every switch. Switching is a live re-render — see Main.applyLanguage.
   ═══════════════════════════════════════════════════════════════════ */
window.I18n = (function () {
  const DEFAULT_LANG = "de";     // German is the default for this study
  const LANGS = ["de", "en"];

  let data = {};
  let lang = DEFAULT_LANG;
  const listeners = [];

  function load(json) { data = json || {}; }

  function get() { return lang; }
  function has(l) { return LANGS.indexOf(l) !== -1; }

  function set(l) {
    if (!has(l) || l === lang) return false;
    lang = l;
    listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error(e); } });
    return true;
  }
  function onChange(fn) { listeners.push(fn); }

  // Walk a dot path through one language block.
  function dig(root, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), root);
  }

  /* Look up `path` in the active language, falling back to the other
     language, then to the path itself (so a typo is visible, not silent).
     `vars` fills {token} placeholders. */
  function t(path, vars) {
    let v = dig(data[lang], path);
    if (v === undefined) {
      const other = LANGS.find(l => l !== lang);
      v = dig(data[other], path);
      if (v !== undefined) console.warn(`i18n: "${path}" missing in "${lang}" — fell back to "${other}"`);
    }
    if (v === undefined) { console.warn(`i18n: "${path}" missing in all languages`); return path; }
    if (typeof v === "string" && vars) {
      return v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    }
    return v;
  }

  // Objects/arrays straight out of the active language (surveys, condition text).
  function block(path) { return t(path); }

  // Every language's display name, for the switcher.
  function options() {
    return LANGS.map(l => ({
      code: l,
      name: dig(data[l], "meta.name") || l.toUpperCase(),
      short: dig(data[l], "meta.short") || l.toUpperCase(),
    }));
  }

  return { load, get, set, has, onChange, t, block, options, LANGS, DEFAULT_LANG };
})();
