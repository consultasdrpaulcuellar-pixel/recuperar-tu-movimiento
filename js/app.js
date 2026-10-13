/* =========================================================
   Motor de Libro Web™ — lógica de la aplicación
   ---------------------------------------------------------
   Lee data/content.json y renderiza todo dinámicamente: portada,
   índice, capítulos (con su imagen hero) y bloques (incluido el
   diagnóstico interactivo).
   Casi nunca hace falta tocar este archivo para hacer un libro
   nuevo: el contenido vive en data/content.json y el estilo en
   css/styles.css. Ver references/content-schema.md para el
   formato completo de bloques soportados.
   ========================================================= */
(() => {
  'use strict';

  // Cambia este prefijo por libro (evita choques si publicas más de un
  // Libro Web bajo el mismo dominio, ya que todos comparten localStorage).
  const STORAGE_PREFIX = 'recuperar_tu_movimiento_';

  // Textos de la interfaz. Cualquiera se puede reemplazar desde
  // content.json → meta.ui (misma clave), sin tocar este archivo.
  const UI_DEFAULTS = {
    start: 'Comenzar la experiencia',
    startOver: 'Empezar desde el principio',
    resume: 'Continuar donde quedaste',
    readingTime: '{n} min de lectura',
    chapterCount: '{n} capítulos',
    offlineHint: 'Puedes leerlo sin conexión después de abrirlo por primera vez.',
    next: 'Siguiente →',
    end: 'Volver a la portada',
    install: 'Descargar la app',
    installIos: 'En iPhone o iPad: toca el botón Compartir y luego «Agregar a inicio».',
    installAndroid: 'En Android: abre el menú ⋮ del navegador y elige «Instalar app» o «Agregar a pantalla principal».',
    installDesktop: 'En computadora: usa el ícono de instalar al final de la barra de direcciones, o el menú del navegador → «Instalar» (Chrome, Edge). En Safari: Archivo → «Agregar al Dock».',
    installDone: 'La app ya está instalada en este dispositivo.',
    sending: 'Enviando…',
    consentRequired: 'Marca la casilla para continuar.',
    imagePending: 'Imagen pendiente',
    imageNoFile: '(sin archivo asignado todavía)',
    reflectionPlaceholder: 'Escribe tu respuesta aquí...',
    reflectionSaved: 'Tu respuesta se guarda automáticamente en este dispositivo.',
    quizFeedback: 'Gracias por responder.',
    ctaPlaceholder: 'tu@email.com',
    ctaButton: 'Enviar',
    ctaSuccess: '¡Listo! Te escribiremos pronto.',
    ctaToast: '¡Gracias! Quedó registrado.',
    diagEyebrow: 'Diagnóstico',
    diagScale: ['Nunca', 'Rara vez', 'Algunas veces', 'Frecuentemente', 'Siempre'],
    diagDimension: 'Dimensión {current} de {total} · {label}',
    diagAnswered: '{done}/{total} respondidas',
    diagPrev: '← Anterior',
    diagNext: 'Siguiente →',
    diagSeeResult: 'Ver mi resultado',
    diagReview: '← Revisar mis respuestas',
    diagGateHeading: 'Tu resultado está listo.',
    diagNamePlaceholder: 'Tu nombre',
    diagEmailPlaceholder: 'tu@email.com',
    diagUnlocked: '¡Gracias! Ya puedes ver tu resultado.',
    diagEmailSent: '¡Gracias! También enviamos tu resultado a {email}.',
    diagPriorityEyebrow: 'Prioridad',
    diagPriorityLevel: 'Nivel',
    diagPriorityOf: '{score} de {max}',
    diagAdvice: 'Primera orientación',
    diagStrength: 'Tu fortaleza',
    diagRisk: 'Tu riesgo',
    diagNextStep: 'Tu siguiente paso',
    diagStage: 'Nivel de preparación',
    blockError: 'Este bloque no se pudo mostrar. Revisa su formato en data/content.json.',
    loadErrorTitle: 'No se pudo cargar el contenido',
    loadErrorText: 'Revisa que data/content.json exista y tenga un formato válido.',
  };

  const FONT_SCALES = [1, 1.12, 1.25];

  const els = {
    app: document.getElementById('app'),
    topbarTitle: document.getElementById('topbarTitle'),
    menuToggle: document.getElementById('menuToggle'),
    sidebar: document.getElementById('sidebar'),
    sidebarClose: document.getElementById('sidebarClose'),
    sidebarOverlay: document.getElementById('sidebarOverlay'),
    chapterList: document.getElementById('chapterList'),
    progressBar: document.getElementById('progressBar'),
    cover: document.getElementById('cover'),
    coverHero: document.getElementById('coverHero'), // se crea solo si meta.coverImage existe
    coverKicker: document.getElementById('coverKicker'),
    coverTitle: document.getElementById('coverTitle'),
    coverSubtitle: document.getElementById('coverSubtitle'),
    coverMeta: document.getElementById('coverMeta'),
    coverHint: document.getElementById('coverHint'),
    startBtn: document.getElementById('startBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    reader: document.getElementById('reader'),
    chapterHero: document.getElementById('chapterHero'),
    chapterKicker: document.getElementById('chapterKicker'),
    chapterTitle: document.getElementById('chapterTitle'),
    chapterBody: document.getElementById('chapterBody'),
    chapterPosition: document.getElementById('chapterPosition'),
    prevBtn: document.getElementById('prevBtn'),
    nextBtn: document.getElementById('nextBtn'),
    fontSizeBtn: document.getElementById('fontSizeBtn'), // puede no existir
    themeToggle: document.getElementById('themeToggle'), // puede no existir en libros de tema fijo
    installBtn: document.getElementById('installBtn'),
    sidebarInstall: document.getElementById('sidebarInstall'), // puede no existir
    installHelp: document.getElementById('installHelp'),
    toast: document.getElementById('toast'),
    offlineBadge: document.getElementById('offlineBadge'),
  };

  let book = null;      // contenido completo del JSON
  let chapters = [];    // atajo a book.chapters
  let currentIndex = -1;
  let ui = UI_DEFAULTS;

  // Texto de interfaz con reemplazo de {variables}.
  function t(key, vars) {
    const str = ui[key] == null ? UI_DEFAULTS[key] : ui[key];
    if (typeof str !== 'string' || !vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, name) => (vars[name] == null ? m : vars[name]));
  }

  /* ---------------- Utilidades de almacenamiento local ---------------- */
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); }
    catch (e) { /* almacenamiento no disponible: seguimos sin persistir */ }
  }

  function getVisited() { return new Set(lsGet('visited', [])); }
  function saveVisited(set) { lsSet('visited', Array.from(set)); }

  /* ---------------- Carga de contenido ---------------- */
  async function loadContent() {
    const res = await fetch('data/content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('No se pudo cargar data/content.json');
    return res.json();
  }

  /* ---------------- Texto: escape + negritas **así** ---------------- */
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
  }
  // Sintaxis en línea que admite cualquier texto de content.json:
  //   **texto**            → resaltado en el color de acento
  //   [texto](https://…)   → enlace (también mailto:, tel: y #id-de-capitulo)
  const LINK_RE = /\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:|#)[^\s)]+)\)/g;
  function mdInline(str) {
    return escapeHtml(str)
      .replace(LINK_RE, (m, text, url) => (url.charAt(0) === '#'
        ? `<a href="${url}">${text}</a>`
        : `<a href="${url}" target="_blank" rel="noopener">${text}</a>`))
      .replace(/\*\*(.+?)\*\*/g, '<strong class="accent-term">$1</strong>');
  }
  // El mismo texto sin marcas (para títulos de pestaña, correos, etc.).
  function plain(str) {
    return String(str == null ? '' : str).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '');
  }
  // Ruta del proyecto → URL absoluta (los correos necesitan URLs completas).
  function absUrl(path) {
    if (!path) return '';
    const meta = book.meta || {};
    const base = meta.url || (meta.leads || {}).publicUrl || location.href.split('#')[0];
    try { return new URL(path, base).href; } catch (e) { return path; }
  }

  function renderCover() {
    const meta = book.meta || {};
    document.title = meta.htmlTitle || plain(meta.title);
    els.topbarTitle.textContent = meta.shortTitle || plain(meta.title);
    if (meta.logo) {
      const logo = document.createElement('img');
      logo.src = meta.logo;
      logo.alt = meta.logoAlt || '';
      logo.addEventListener('error', () => logo.remove());
      els.topbarTitle.prepend(logo);
    }
    els.coverKicker.textContent = meta.coverKicker || '';
    els.coverTitle.innerHTML = mdInline(meta.title);
    els.coverSubtitle.innerHTML = mdInline(meta.subtitle || '');

    // Imagen de portada: basta con meta.coverImage, el motor arma el HTML.
    // Si el archivo todavía no existe, la portada queda solo con texto.
    if (meta.coverImage) {
      if (!els.coverHero) {
        const wrap = document.createElement('div');
        wrap.className = 'cover-hero-wrap';
        const img = document.createElement('img');
        img.id = 'coverHero';
        img.className = 'cover-hero';
        const fade = document.createElement('div');
        fade.className = 'cover-hero-fade';
        wrap.appendChild(img);
        wrap.appendChild(fade);
        els.cover.insertBefore(wrap, els.cover.firstChild);
        els.coverHero = img;
      }
      const heroWrap = els.coverHero.closest('.cover-hero-wrap') || els.coverHero;
      els.coverHero.addEventListener('error', () => { heroWrap.hidden = true; });
      els.coverHero.alt = meta.coverImageAlt || '';
      // "poster": la imagen es la portada diseñada del libro, con su título
      // y subtítulo incluidos. Se muestra entera y el título en texto queda
      // solo para lectores de pantalla y buscadores.
      const poster = meta.coverMode === 'poster';
      els.cover.classList.toggle('cover-poster', poster);
      if (meta.coverAspect && !poster) els.coverHero.style.aspectRatio = String(meta.coverAspect).replace(':', ' / ');
      if (meta.coverPosition && !poster) els.coverHero.style.objectPosition = meta.coverPosition;
      els.coverHero.addEventListener('error', () => els.cover.classList.remove('cover-poster'));
      // Con la imagen cargada (y sin póster), el título va escrito sobre ella.
      els.coverHero.addEventListener('load', () => els.cover.classList.toggle('cover-overlay', !poster));
      els.coverHero.addEventListener('error', () => els.cover.classList.remove('cover-overlay'));
      els.coverHero.src = meta.coverImage;
    }

    const parts = [];
    if (meta.readingTimeMinutes) parts.push(t('readingTime', { n: meta.readingTimeMinutes }));
    parts.push(t('chapterCount', { n: chapters.length }));
    els.coverMeta.textContent = parts.join(' · ');
    if (els.coverHint) els.coverHint.textContent = t('offlineHint');
  }

  // Si el lector ya había empezado, la portada le ofrece retomar.
  function updateResume() {
    const last = lsGet('lastChapter', null);
    const canResume = !!last && chapters.some(c => c.id === last);
    els.startBtn.textContent = canResume ? t('startOver') : ((book.meta || {}).startLabel || t('start'));
    els.startBtn.className = canResume ? 'btn btn-ghost' : 'btn btn-primary';
    if (!els.resumeBtn) return;
    els.resumeBtn.hidden = !canResume;
    els.resumeBtn.textContent = t('resume');
    els.resumeBtn.dataset.chapterId = canResume ? last : '';
  }

  function renderSidebar() {
    els.chapterList.innerHTML = '';
    const visited = getVisited();
    chapters.forEach((ch, idx) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'chapter-link' + (visited.has(ch.id) ? ' done' : '');
      btn.dataset.chapterId = ch.id;
      btn.innerHTML = `<span class="num">${escapeHtml(chapterLabels[idx])}</span><span>${escapeHtml(ch.title)}</span>`;
      btn.addEventListener('click', () => {
        goToChapter(ch.id);
        closeSidebar();
      });
      li.appendChild(btn);
      els.chapterList.appendChild(li);
    });
    highlightActiveChapter();
  }

  // Número que muestra el índice para cada capítulo. Los capítulos con
  // "numbered": false (prólogo, introducción, epílogo) no llevan número ni
  // consumen uno, así el Capítulo 1 sigue siendo el 01.
  let chapterLabels = [];
  function computeChapterLabels() {
    let n = 0;
    chapterLabels = chapters.map(ch => {
      if (ch.numbered === false) return '·';
      if (ch.number != null) return typeof ch.number === 'number' ? String(ch.number).padStart(2, '0') : String(ch.number);
      n += 1;
      return String(n).padStart(2, '0');
    });
  }

  function highlightActiveChapter() {
    const activeId = (chapters[currentIndex] || {}).id;
    els.chapterList.querySelectorAll('.chapter-link').forEach(a => {
      const active = a.dataset.chapterId === activeId;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }

  /* ---------------- Imágenes (hero de capítulo y bloque image) ----------------
     Reserva el espacio exacto y muestra un placeholder si el archivo todavía
     no existe. Así se puede maquetar el libro completo antes de tener las
     imágenes finales, y sumarlas después sin tocar nada más. */
  function buildImageFigure(data, opts = {}) {
    const figure = document.createElement('figure');
    const frame = document.createElement('div');
    frame.className = 'image-frame';
    frame.style.aspectRatio = String(data.aspect || opts.defaultAspect || '16:9').replace(':', ' / ');

    const placeholder = document.createElement('div');
    placeholder.className = 'image-placeholder';
    placeholder.innerHTML = `
      <span class="ph-icon" aria-hidden="true">🖼️</span>
      <span class="ph-alt">${escapeHtml(data.alt || t('imagePending'))}</span>
      <span class="ph-file">${escapeHtml(data.src || t('imageNoFile'))}</span>
    `;

    if (data.src) {
      const img = document.createElement('img');
      img.loading = opts.eager ? 'eager' : 'lazy';
      img.decoding = 'async';
      img.alt = data.alt || '';
      img.addEventListener('error', () => { img.remove(); frame.appendChild(placeholder); });
      img.src = data.src;
      frame.appendChild(img);
    } else {
      frame.appendChild(placeholder);
    }

    figure.appendChild(frame);
    if (data.caption) {
      const cap = document.createElement('figcaption');
      cap.className = 'image-caption';
      cap.textContent = data.caption;
      figure.appendChild(cap);
    }
    return figure;
  }

  // chapter.hero admite un objeto { src, alt, caption, aspect } o solo la ruta.
  function normalizeHero(hero) {
    if (!hero) return null;
    return typeof hero === 'string' ? { src: hero } : hero;
  }

  function renderChapterHero(chapter) {
    if (!els.chapterHero) return;
    els.chapterHero.innerHTML = '';
    const hero = normalizeHero(chapter.hero);
    els.chapterHero.hidden = !hero;
    if (hero) els.chapterHero.appendChild(buildImageFigure(hero, { eager: true, defaultAspect: '16:9' }));
  }

  /* ---------------- Render de bloques de contenido ---------------- */
  const blockRenderers = {
    lead(block) {
      const p = document.createElement('p');
      p.className = 'lead';
      p.innerHTML = mdInline(block.text);
      return p;
    },
    paragraph(block) {
      const p = document.createElement('p');
      p.innerHTML = mdInline(block.text);
      return p;
    },
    heading(block) {
      const h = document.createElement('h2');
      h.innerHTML = mdInline(block.text);
      return h;
    },
    quote(block) {
      const bq = document.createElement('blockquote');
      bq.className = 'blockquote';
      bq.innerHTML = mdInline(block.text);
      if (block.attribution) {
        const cite = document.createElement('cite');
        cite.className = 'blockquote-cite';
        cite.textContent = block.attribution;
        bq.appendChild(cite);
      }
      return bq;
    },
    list(block) {
      const ul = document.createElement(block.style === 'numbered' ? 'ol' : 'ul');
      ul.className = 'list-block';
      (block.items || []).forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = mdInline(item);
        ul.appendChild(li);
      });
      return ul;
    },
    flow(block) {
      const wrap = document.createElement('div');
      wrap.className = 'flow';
      (block.steps || []).forEach((step, i) => {
        if (i > 0) {
          const arrow = document.createElement('span');
          arrow.className = 'flow-arrow';
          arrow.setAttribute('aria-hidden', 'true');
          arrow.textContent = '→';
          wrap.appendChild(arrow);
        }
        const pill = document.createElement('span');
        pill.className = 'flow-step';
        pill.textContent = step;
        wrap.appendChild(pill);
      });
      return wrap;
    },
    pillars(block) {
      const grid = document.createElement('div');
      grid.className = 'pillars';
      (block.items || []).forEach(item => {
        const card = document.createElement('div');
        card.className = 'pillar-card';
        const h3 = document.createElement('h3');
        h3.innerHTML = mdInline(item.title);
        const p = document.createElement('p');
        p.innerHTML = mdInline(item.text);
        card.appendChild(h3);
        card.appendChild(p);
        grid.appendChild(card);
      });
      return grid;
    },

    image(block) {
      const wrap = document.createElement('div');
      wrap.className = 'image-block';
      wrap.appendChild(buildImageFigure(block));
      return wrap;
    },

    reflection(block) {
      const wrap = document.createElement('div');
      wrap.className = 'interactive-block reflection-block';
      wrap.dataset.reflectionId = block.id;
      const label = document.createElement('label');
      label.className = 'q-label';
      label.textContent = block.question;
      label.setAttribute('for', 'reflection-' + block.id);
      const textarea = document.createElement('textarea');
      textarea.id = 'reflection-' + block.id;
      textarea.placeholder = block.placeholder || t('reflectionPlaceholder');
      textarea.value = lsGet('reflection_' + block.id, '');
      const note = document.createElement('span');
      note.className = 'save-note';
      note.textContent = t('reflectionSaved');
      wrap.appendChild(label);
      wrap.appendChild(textarea);
      wrap.appendChild(note);
      return wrap;
    },
    quiz(block) {
      const wrap = document.createElement('div');
      wrap.className = 'interactive-block quiz-block';
      wrap.dataset.quizId = block.id;
      const label = document.createElement('span');
      label.className = 'q-label';
      label.textContent = block.question;
      const options = document.createElement('div');
      options.className = 'quiz-options';
      const saved = lsGet('quiz_' + block.id, null);
      (block.options || []).forEach((opt, i) => {
        const optBtn = document.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'quiz-option' + (saved === i ? ' selected' : '');
        optBtn.setAttribute('aria-pressed', String(saved === i));
        optBtn.dataset.optionIndex = String(i);
        optBtn.textContent = opt;
        options.appendChild(optBtn);
      });
      const feedback = document.createElement('p');
      feedback.className = 'quiz-feedback';
      feedback.setAttribute('aria-live', 'polite');
      feedback.hidden = saved === null;
      feedback.textContent = saved === null ? '' : (block.feedback || t('quizFeedback'));
      wrap.appendChild(label);
      wrap.appendChild(options);
      wrap.appendChild(feedback);
      return wrap;
    },
    // Botón-enlace: lleva a una agenda, WhatsApp, página de venta, etc.
    button(block) {
      const wrap = document.createElement('div');
      wrap.className = 'button-block';
      const a = document.createElement('a');
      a.className = 'btn ' + (block.style === 'ghost' ? 'btn-ghost' : 'btn-primary');
      a.href = block.url || '#';
      if (!/^#/.test(a.getAttribute('href'))) { a.target = '_blank'; a.rel = 'noopener'; }
      a.textContent = block.text || '';
      wrap.appendChild(a);
      if (block.note) {
        const note = document.createElement('span');
        note.className = 'save-note';
        note.textContent = block.note;
        wrap.appendChild(note);
      }
      return wrap;
    },
    cta(block) {
      const wrap = document.createElement('div');
      wrap.className = 'cta-block';
      wrap.dataset.ctaId = block.id;
      const h2 = document.createElement('h2');
      h2.innerHTML = mdInline(block.heading);
      const p = document.createElement('p');
      p.innerHTML = mdInline(block.text);
      const form = document.createElement('form');
      form.className = 'cta-form';
      form.innerHTML = `
        <input type="email" name="email" placeholder="${escapeHtml(block.placeholder || t('ctaPlaceholder'))}" aria-label="${escapeHtml(block.placeholder || t('ctaPlaceholder'))}" required autocomplete="email" />
        <button type="submit" class="btn btn-primary">${escapeHtml(block.buttonText || t('ctaButton'))}</button>
        ${consentHtml()}
      `;
      const success = document.createElement('p');
      success.className = 'cta-success';
      success.hidden = true;
      success.textContent = block.successText || t('ctaSuccess');
      wrap.appendChild(h2);
      wrap.appendChild(p);
      wrap.appendChild(form);
      wrap.appendChild(success);
      return wrap;
    },

    // Diagnóstico interactivo de varias dimensiones con escala Likert,
    // que calcula un perfil y lo bloquea detrás de nombre + correo.
    // Ver references/content-schema.md → "Bloque diagnostic".
    diagnostic(block) {
      const wrap = document.createElement('div');
      wrap.className = 'diagnostic';
      mountDiagnostic(wrap, block);
      return wrap;
    },

    /* ---- Bloques propios de este libro (ver README → "Bloques de este libro") ---- */

    // Recuadro de aviso o recordatorio.
    note(block) {
      const div = document.createElement('div');
      div.className = 'note-block';
      div.innerHTML = mdInline(block.text);
      return div;
    },
    // Tabla. Con "stack": true, en celular cada fila se muestra como tarjeta.
    table(block) {
      const wrap = document.createElement('div');
      wrap.className = 'table-block' + (block.stack ? ' table-stack' : '');
      const table = document.createElement('table');
      const headers = block.headers || [];
      if (headers.length) {
        const thead = document.createElement('thead');
        const tr = document.createElement('tr');
        headers.forEach((h, i) => {
          const th = document.createElement('th');
          th.scope = 'col';
          th.innerHTML = mdInline(h);
          if (block.alignLast === 'right' && i === headers.length - 1) th.className = 'num';
          tr.appendChild(th);
        });
        thead.appendChild(tr);
        table.appendChild(thead);
      }
      const tbody = document.createElement('tbody');
      (block.rows || []).forEach(row => {
        const tr = document.createElement('tr');
        row.forEach((cell, i) => {
          const td = document.createElement(i === 0 && block.stack ? 'th' : 'td');
          if (td.tagName === 'TH') td.scope = 'row';
          td.dataset.label = plain(headers[i] || '');
          td.innerHTML = mdInline(cell);
          if (block.alignLast === 'right' && i === row.length - 1) td.className = 'num';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    },
    // Lista de verificación: las marcas se guardan en el dispositivo.
    checklist(block) {
      const wrap = document.createElement('div');
      wrap.className = 'interactive-block checklist-block';
      const saved = lsGet('check_' + block.id, []);
      (block.items || []).forEach((item, i) => {
        const label = document.createElement('label');
        label.className = 'check-row';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = saved.indexOf(i) !== -1;
        box.addEventListener('change', () => {
          const marked = [];
          wrap.querySelectorAll('input[type="checkbox"]').forEach((b, n) => { if (b.checked) marked.push(n); });
          lsSet('check_' + block.id, marked);
        });
        const span = document.createElement('span');
        span.innerHTML = mdInline(item);
        label.appendChild(box);
        label.appendChild(span);
        wrap.appendChild(label);
      });
      const note = document.createElement('span');
      note.className = 'save-note';
      note.textContent = block.note || 'Tus marcas se guardan automáticamente en este dispositivo.';
      wrap.appendChild(note);
      return wrap;
    },
    // Botón que imprime el capítulo (la ficha), sin barras ni imágenes.
    print(block) {
      const wrap = document.createElement('div');
      wrap.className = 'button-block no-print';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-primary';
      btn.textContent = block.text || 'Imprimir';
      btn.addEventListener('click', () => window.print());
      wrap.appendChild(btn);
      if (block.note) {
        const note = document.createElement('span');
        note.className = 'save-note';
        note.textContent = block.note;
        wrap.appendChild(note);
      }
      return wrap;
    },
    // Campos para completar (la ficha de consulta).
    fields(block) {
      const wrap = document.createElement('div');
      wrap.className = 'fields-block';
      mountFields(wrap, block);
      return wrap;
    },
    // Test de Limitación Articular Funcional (registro en el dispositivo).
    functest(block) {
      const wrap = document.createElement('div');
      wrap.className = 'diagnostic functest';
      mountFunctionalTest(wrap, block);
      return wrap;
    },
    // Diario de evolución: los registros guardados del test.
    diary(block) {
      const wrap = document.createElement('div');
      wrap.className = 'diary-block';
      mountDiary(wrap, block);
      return wrap;
    },
  };

  /* =========================================================
     Leads — a dónde van el nombre y el correo que deja el lector.
     Se configura en content.json → meta.leads (sin tocar este archivo):
       emailjs: envía un correo con una plantilla de EmailJS (por ejemplo,
                el resultado del diagnóstico al lector, con copia al autor).
       webhook: envía los datos en JSON a una URL (CRM, n8n, Zapier, etc.).
     Sin meta.leads el libro funciona en modo demo: los datos quedan solo
     en el navegador del visitante.
     Ver references/leads-emailjs.md.
     ========================================================= */
  const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';

  function leadsConfig() { return (book && book.meta && book.meta.leads) || {}; }

  // Casilla de consentimiento (meta.leads.consent), para cualquier formulario.
  function consentHtml() {
    const consent = leadsConfig().consent;
    if (!consent || !consent.text) return '';
    return `<label class="consent-row"><input type="checkbox" name="consent"${consent.required === false ? '' : ' required'} /><span>${mdInline(consent.text)}</span></label>`;
  }
  function readConsent(form) {
    const box = form.querySelector('input[name="consent"]');
    return box ? box.checked : null;
  }

  async function deliverLead(lead) {
    const cfg = leadsConfig();
    const jobs = [];
    const ej = cfg.emailjs;
    const templateId = ej && ej.templates && ej.templates[lead.type];
    if (ej && ej.serviceId && ej.publicKey && templateId) {
      jobs.push(fetch(EMAILJS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: ej.serviceId, template_id: templateId, user_id: ej.publicKey, template_params: lead.params }),
      }).then(res => { if (!res.ok) throw new Error('EmailJS respondió ' + res.status); return 'emailjs'; }));
    }
    if (cfg.webhook && cfg.webhook.url) {
      jobs.push(fetch(cfg.webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': cfg.webhook.contentType || 'application/json' },
        body: JSON.stringify(lead),
      }).then(res => { if (!res.ok) throw new Error('El webhook respondió ' + res.status); return 'webhook'; }));
    }
    if (!jobs.length) return { configured: false, sent: [] };
    const results = await Promise.allSettled(jobs);
    const failed = results.filter(r => r.status === 'rejected');
    failed.forEach(r => console.error('[Libro Web] No se pudo enviar el lead:', r.reason));
    return { configured: true, sent: results.filter(r => r.status === 'fulfilled').map(r => r.value), failed: failed.length };
  }

  // Guarda el lead en este dispositivo y lo envía. Si el envío falla (sin
  // conexión, servicio caído) queda en cola y se reintenta más tarde.
  async function submitLead(lead) {
    const meta = book.meta || {};
    lead.date = new Date().toISOString();
    lead.book = plain(meta.title);
    lead.params = Object.assign({
      to_name: lead.name || '', to_email: lead.email, name: lead.name || '', email: lead.email,
      book_title: plain(meta.title), book_url: absUrl('./'), source: lead.source, date: lead.date,
      consent: lead.consent == null ? '' : (lead.consent ? 'sí' : 'no'),
    }, lead.params || {});

    const log = lsGet('leads', []);
    log.push({ type: lead.type, source: lead.source, name: lead.name, email: lead.email, consent: lead.consent, date: lead.date });
    lsSet('leads', log);

    let outcome;
    try { outcome = await deliverLead(lead); }
    catch (err) { console.error(err); outcome = { configured: true, sent: [], failed: 1 }; }
    if (outcome.configured && outcome.failed) {
      const pending = lsGet('pendingLeads', []);
      pending.push(lead);
      lsSet('pendingLeads', pending.slice(-20));
    }
    return outcome;
  }

  async function retryPendingLeads() {
    const pending = lsGet('pendingLeads', []);
    if (!pending.length || !navigator.onLine) return;
    lsSet('pendingLeads', []);
    const still = [];
    for (const lead of pending) {
      let outcome;
      try { outcome = await deliverLead(lead); } catch (e) { outcome = { failed: 1 }; }
      lead.attempts = (lead.attempts || 0) + 1;
      if (outcome.failed && lead.attempts < 5) still.push(lead);
    }
    if (still.length) lsSet('pendingLeads', lsGet('pendingLeads', []).concat(still));
  }

  function blockErrorNote(block) {
    const note = document.createElement('p');
    note.className = 'block-error';
    note.textContent = `${t('blockError')} (type: "${block && block.type}"${block && block.id ? `, id: "${block.id}"` : ''})`;
    return note;
  }

  function renderChapterBody(chapter) {
    els.chapterBody.innerHTML = '';
    (chapter.blocks || []).forEach((block, i) => {
      const renderer = block && blockRenderers[block.type];
      if (!renderer) {
        // tipo de bloque desconocido: se ignora sin romper el render
        console.warn('[Libro Web] Bloque ignorado, tipo desconocido:', block && block.type, 'en', chapter.id);
        return;
      }
      // Los bloques interactivos guardan su estado por id: si falta, se
      // deriva uno estable de la posición para que no choquen entre sí.
      if (!block.id) block.id = `${chapter.id}-${block.type}-${i}`;
      let node;
      try {
        node = renderer(block);
      } catch (err) {
        // un bloque mal formado no debe tumbar el capítulo entero
        console.error('[Libro Web] Error al mostrar un bloque en', chapter.id, block, err);
        node = blockErrorNote(block);
      }
      els.chapterBody.appendChild(node);
    });
  }

  /* =========================================================
     Diagnóstico — componente autocontenido: guarda respuestas y
     desbloqueo en localStorage, y maneja sus propios eventos (no
     depende de la delegación de eventos general).
     ========================================================= */
  function mountDiagnostic(container, block) {
    const dimensions = (Array.isArray(block.dimensions) ? block.dimensions : [])
      .filter(d => d && Array.isArray(d.items) && d.items.length)
      .map((d, i) => Object.assign({}, d, { id: d.id || 'dim-' + (i + 1) }));
    const profiles = Array.isArray(block.profiles) ? block.profiles : [];
    if (!dimensions.length || !profiles.length) {
      console.error('[Libro Web] Diagnóstico sin "dimensions" (con "items") o sin "profiles":', block.id);
      container.appendChild(blockErrorNote(block));
      return;
    }
    const scaleLabels = (Array.isArray(block.scaleLabels) && block.scaleLabels.length) ? block.scaleLabels : t('diagScale');
    const scaleMax = scaleLabels.length;

    function loadAnswers() {
      const saved = lsGet('diag_answers_' + block.id, null);
      const answers = {};
      dimensions.forEach(dim => {
        const savedDim = (saved && Array.isArray(saved[dim.id])) ? saved[dim.id] : [];
        answers[dim.id] = dim.items.map((_, i) => (typeof savedDim[i] === 'number' ? savedDim[i] : null));
      });
      return answers;
    }

    const state = {
      step: Math.max(0, Math.min(Number(lsGet('diag_step_' + block.id, 0)) || 0, dimensions.length)),
      answers: loadAnswers(),
      unlocked: lsGet('diag_unlocked_' + block.id, false),
    };

    function dimAnswered(dim) { return state.answers[dim.id].every(v => v !== null); }
    function allAnswered() { return dimensions.every(dimAnswered); }

    function toPct(avg) { return scaleMax > 1 ? Math.round(((avg - 1) / (scaleMax - 1)) * 100) : 100; }

    function computeScores() {
      const dimAverages = dimensions.map(dim => {
        const vals = state.answers[dim.id];
        const sum = vals.reduce((a, b) => a + b, 0);
        const avg = sum / vals.length;
        return { id: dim.id, label: dim.label, avg, sum, max: vals.length * scaleMax, pct: toPct(avg), dim };
      });
      const overall = dimAverages.reduce((a, d) => a + d.avg, 0) / dimAverages.length;
      return { dimAverages, overall };
    }

    // Dimensiones a las que conviene prestar atención primero
    // (block.priorities): las de menor puntaje, o las de mayor si la escala
    // mide un problema ("order": "highest"). En empates gana el orden del JSON.
    function pickPriorities(dimAverages) {
      const cfg = block.priorities;
      if (!cfg) return [];
      const dir = cfg.order === 'highest' ? -1 : 1;
      return dimAverages.map((d, i) => ({ d, i }))
        .sort((a, b) => (a.d.avg - b.d.avg) * dir || a.i - b.i)
        .slice(0, Math.max(1, Math.min(cfg.count || 3, dimAverages.length)))
        .map(x => x.d);
    }

    // Variables que recibe la plantilla de correo (EmailJS) o el webhook.
    function resultParams(dimAverages, overall) {
      const profile = pickByMax(profiles, overall);
      const stage = (Array.isArray(block.stages) && block.stages.length) ? pickByMax(block.stages, overall) : null;
      const pri = pickPriorities(dimAverages);
      const cfg = block.priorities || {};
      const mail = block.email || {};
      const params = {
        diagnostic_title: plain(block.title),
        overall_score: overall.toFixed(1), overall_pct: toPct(overall),
        profile_emoji: profile.emoji || '', profile_title: plain(profile.title),
        profile_strength: plain(profile.strength), profile_risk: plain(profile.risk), profile_next: plain(profile.next),
        stage_label: stage ? plain(stage.label) : '',
        priority_count: pri.length,
        image_hero: absUrl(mail.heroImage || (book.meta || {}).coverImage),
        image_closing: absUrl(mail.closingImage),
        cta_text: mail.ctaText || '', cta_url: mail.ctaUrl ? absUrl(mail.ctaUrl) : absUrl('./'),
      };
      dimAverages.forEach((d, i) => {
        params[`dim_${i + 1}_label`] = d.label;
        params[`dim_${i + 1}_pct`] = d.pct;
        params[`dim_${i + 1}_score`] = d.sum;
      });
      pri.forEach((d, i) => {
        const k = `priority_${i + 1}_`;
        params[k + 'label'] = d.label;
        params[k + 'score'] = d.sum;
        params[k + 'max'] = d.max;
        params[k + 'pct'] = d.pct;
        params[k + 'text'] = plain(d.dim.insight);
        params[k + 'advice'] = plain(d.dim.advice);
        params[k + 'image'] = absUrl(d.dim.image);
      });
      // Bloques ya armados, por si la plantilla prefiere {{{dims_html}}} y
      // {{{priorities_html}}} en vez de las variables sueltas.
      params.dims_html = dimAverages.map(d =>
        `<p style="margin:0 0 6px"><strong>${escapeHtml(d.label)}</strong>: ${d.pct}%</p>`).join('');
      params.priorities_html = pri.map((d, i) =>
        `<div style="margin:0 0 22px"><p style="margin:0 0 4px;font-size:12px;letter-spacing:2px;text-transform:uppercase">${escapeHtml(cfg.eyebrow || t('diagPriorityEyebrow'))} ${String(i + 1).padStart(2, '0')}</p>` +
        `<h3 style="margin:0 0 8px">${escapeHtml(d.label)}</h3>` +
        `<p style="margin:0 0 8px"><strong>${escapeHtml(cfg.levelLabel || t('diagPriorityLevel'))}:</strong> ${escapeHtml(t('diagPriorityOf', { score: d.sum, max: d.max }))}</p>` +
        (d.dim.insight ? `<p style="margin:0 0 8px">${escapeHtml(plain(d.dim.insight))}</p>` : '') +
        (d.dim.advice ? `<p style="margin:0"><strong>${escapeHtml(t('diagAdvice'))}:</strong> ${escapeHtml(plain(d.dim.advice))}</p>` : '') +
        '</div>').join('');
      return params;
    }

    function pickByMax(list, value) {
      return list.find(x => value <= x.max) || list[list.length - 1];
    }

    function render() {
      container.innerHTML = '';
      lsSet('diag_step_' + block.id, state.step);

      const eyebrow = document.createElement('p');
      eyebrow.className = 'diag-eyebrow';
      eyebrow.textContent = block.eyebrow || t('diagEyebrow');
      container.appendChild(eyebrow);

      const title = document.createElement('h3');
      title.className = 'diag-title';
      title.innerHTML = mdInline(block.title);
      container.appendChild(title);

      if (state.step === 0) {
        if (block.subtitle) {
          const subtitle = document.createElement('p');
          subtitle.className = 'diag-subtitle';
          subtitle.textContent = block.subtitle;
          container.appendChild(subtitle);
        }
        if (block.intro) {
          const intro = document.createElement('p');
          intro.className = 'diag-intro';
          intro.textContent = block.intro;
          container.appendChild(intro);
        }
      }

      const totalSteps = dimensions.length + 1;
      const dots = document.createElement('div');
      dots.className = 'diag-steps';
      dots.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < totalSteps; i++) {
        const dot = document.createElement('span');
        dot.className = 'diag-step-dot' + (i < state.step ? ' done' : i === state.step ? ' active' : '');
        dots.appendChild(dot);
      }
      container.appendChild(dots);

      if (state.step < dimensions.length) {
        renderDimensionStep(dimensions[state.step]);
      } else {
        renderResultsStep();
      }
    }

    function goToStep(step) {
      state.step = step;
      render();
      // al cambiar de paso, volver al inicio del componente
      if (container.getBoundingClientRect().top < 0) container.scrollIntoView({ block: 'start' });
    }

    function renderDimensionStep(dim) {
      const dimLabel = document.createElement('p');
      dimLabel.className = 'diag-dim-label';
      dimLabel.textContent = t('diagDimension', { current: state.step + 1, total: dimensions.length, label: dim.label });
      container.appendChild(dimLabel);

      const dimQuestion = document.createElement('p');
      dimQuestion.className = 'diag-dim-question';
      dimQuestion.textContent = dim.question || '';
      container.appendChild(dimQuestion);

      const count = document.createElement('span');
      count.className = 'diag-count';
      const nextBtn = document.createElement('button');

      // Elegir una respuesta actualiza solo lo necesario (sin redibujar el
      // componente), para no perder el foco ni la posición de lectura.
      function refreshProgress() {
        const done = state.answers[dim.id].filter(v => v !== null).length;
        count.textContent = t('diagAnswered', { done, total: dim.items.length });
        nextBtn.disabled = !dimAnswered(dim);
      }

      dim.items.forEach((itemText, itemIdx) => {
        const itemWrap = document.createElement('div');
        itemWrap.className = 'diag-item';
        const p = document.createElement('p');
        p.className = 'diag-item-text';
        p.textContent = itemText;
        const scale = document.createElement('div');
        scale.className = 'diag-scale';
        scale.style.setProperty('--scale-cols', String(scaleMax));
        scale.setAttribute('role', 'group');
        scale.setAttribute('aria-label', itemText);
        scaleLabels.forEach((label, i) => {
          const value = i + 1;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = label;
          const selected = state.answers[dim.id][itemIdx] === value;
          btn.classList.toggle('selected', selected);
          btn.setAttribute('aria-pressed', String(selected));
          btn.addEventListener('click', () => {
            state.answers[dim.id][itemIdx] = value;
            lsSet('diag_answers_' + block.id, state.answers);
            scale.querySelectorAll('button').forEach(b => {
              b.classList.toggle('selected', b === btn);
              b.setAttribute('aria-pressed', String(b === btn));
            });
            refreshProgress();
          });
          scale.appendChild(btn);
        });
        itemWrap.appendChild(p);
        itemWrap.appendChild(scale);
        container.appendChild(itemWrap);
      });

      const nav = document.createElement('div');
      nav.className = 'diag-nav';

      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'btn btn-ghost';
      backBtn.textContent = t('diagPrev');
      backBtn.disabled = state.step === 0;
      backBtn.addEventListener('click', () => goToStep(state.step - 1));

      nextBtn.type = 'button';
      nextBtn.className = 'btn btn-primary';
      const isLast = state.step === dimensions.length - 1;
      nextBtn.textContent = isLast ? t('diagSeeResult') : t('diagNext');
      nextBtn.addEventListener('click', () => goToStep(state.step + 1));
      refreshProgress();

      nav.appendChild(backBtn);
      nav.appendChild(count);
      nav.appendChild(nextBtn);
      container.appendChild(nav);
    }

    function renderResultsStep() {
      if (!allAnswered()) {
        const idx = dimensions.findIndex(d => !dimAnswered(d));
        state.step = idx === -1 ? 0 : idx;
        render();
        return;
      }

      const { dimAverages, overall } = computeScores();

      if (!state.unlocked) {
        renderGate();
      } else {
        renderFullResults(dimAverages, overall);
      }

      const backBtn = document.createElement('button');
      backBtn.type = 'button';
      backBtn.className = 'btn btn-ghost';
      backBtn.textContent = t('diagReview');
      backBtn.addEventListener('click', () => goToStep(dimensions.length - 1));
      container.appendChild(backBtn);
    }

    function renderGate() {
      const gate = block.gate || {};
      const wrap = document.createElement('div');
      wrap.className = 'diag-gate';
      wrap.innerHTML = `
        <h3>${escapeHtml(gate.heading || t('diagGateHeading'))}</h3>
        <ul>${(gate.bullets || []).map(b => `<li>✅ ${escapeHtml(b)}</li>`).join('')}</ul>
      `;
      const namePh = gate.namePlaceholder || t('diagNamePlaceholder');
      const emailPh = gate.emailPlaceholder || t('diagEmailPlaceholder');
      const form = document.createElement('form');
      form.className = 'diag-gate-form';
      form.innerHTML = `
        <input type="text" name="name" placeholder="${escapeHtml(namePh)}" aria-label="${escapeHtml(namePh)}" required autocomplete="name" />
        <input type="email" name="email" placeholder="${escapeHtml(emailPh)}" aria-label="${escapeHtml(emailPh)}" required autocomplete="email" />
        <button type="submit" class="btn btn-primary">${escapeHtml(gate.buttonText || t('diagSeeResult'))}</button>
        ${consentHtml()}
      `;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = form.querySelector('input[name="name"]').value.trim();
        const email = form.querySelector('input[name="email"]').value.trim();
        if (!email) return;

        // El destino del lead se configura en content.json → meta.leads.
        // El resultado se muestra aunque el envío falle: queda en cola y se
        // reintenta solo.
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = t('sending');
        const { dimAverages, overall } = computeScores();
        const outcome = await submitLead({ type: 'diagnostic', source: 'diagnostico_' + block.id, name, email,
          consent: readConsent(form), params: resultParams(dimAverages, overall) });

        state.unlocked = true;
        lsSet('diag_unlocked_' + block.id, true);
        render();
        const emailed = outcome.configured && outcome.sent.indexOf('emailjs') !== -1;
        showToast(emailed ? t('diagEmailSent', { email }) : t('diagUnlocked'), emailed ? 5000 : 3200);
      });
      wrap.appendChild(form);
      if (gate.note) {
        const note = document.createElement('p');
        note.className = 'save-note diag-gate-note';
        note.textContent = gate.note;
        wrap.appendChild(note);
      }
      container.appendChild(wrap);
    }

    function renderFullResults(dimAverages, overall) {
      const profile = pickByMax(profiles, overall);
      const stage = (Array.isArray(block.stages) && block.stages.length) ? pickByMax(block.stages, overall) : null;

      const profileEl = document.createElement('div');
      profileEl.className = 'diag-profile';
      profileEl.innerHTML = `
        <div class="diag-profile-emoji" aria-hidden="true">${escapeHtml(profile.emoji || '')}</div>
        <div class="diag-profile-title">${escapeHtml(profile.title || '')}</div>
        <div class="diag-profile-row"><b>${escapeHtml(t('diagStrength'))}</b>${mdInline(profile.strength || '')}</div>
        <div class="diag-profile-row"><b>${escapeHtml(t('diagRisk'))}</b>${mdInline(profile.risk || '')}</div>
        <div class="diag-profile-row"><b>${escapeHtml(t('diagNextStep'))}</b>${mdInline(profile.next || '')}</div>
      `;
      container.appendChild(profileEl);

      // Barras de 0 a 100 %: la respuesta más baja en todo (1) es 0 % y la
      // más alta en todo es 100 %.
      const barsWrap = document.createElement('div');
      barsWrap.className = 'diag-bars';
      dimAverages.forEach(d => {
        const pct = d.pct;
        const row = document.createElement('div');
        row.className = 'diag-bar-row';
        row.innerHTML = `
          <div class="diag-bar-head"><span>${escapeHtml(d.label)}</span><span>${pct}%</span></div>
          <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${Math.max(3, pct)}%"></div></div>
        `;
        barsWrap.appendChild(row);
      });
      container.appendChild(barsWrap);

      const pri = pickPriorities(dimAverages);
      if (pri.length) {
        const cfg = block.priorities;
        const wrap = document.createElement('div');
        wrap.className = 'diag-priorities';
        if (cfg.heading) {
          const h = document.createElement('h4');
          h.className = 'diag-priorities-heading';
          h.textContent = cfg.heading;
          wrap.appendChild(h);
        }
        pri.forEach((d, i) => {
          const card = document.createElement('div');
          card.className = 'diag-priority';
          card.innerHTML = `
            <div class="diag-priority-eyebrow">${escapeHtml(cfg.eyebrow || t('diagPriorityEyebrow'))} ${String(i + 1).padStart(2, '0')}</div>
            <div class="diag-priority-title">${escapeHtml(d.label)}</div>
            <div class="diag-priority-level"><b>${escapeHtml(cfg.levelLabel || t('diagPriorityLevel'))}:</b> ${escapeHtml(t('diagPriorityOf', { score: d.sum, max: d.max }))}</div>
            ${d.dim.insight ? `<div class="diag-priority-text">${mdInline(d.dim.insight)}</div>` : ''}
            ${d.dim.advice ? `<div class="diag-priority-text"><b>${escapeHtml(t('diagAdvice'))}</b>${mdInline(d.dim.advice)}</div>` : ''}
          `;
          wrap.appendChild(card);
        });
        container.appendChild(wrap);
      }

      if (stage) {
        const stageEl = document.createElement('div');
        stageEl.className = 'diag-stage';
        stageEl.innerHTML = `
          <div class="diag-stage-label">${escapeHtml(block.stageLabel || t('diagStage'))}</div>
          <div class="diag-stage-value">${escapeHtml(stage.label || '')}</div>
        `;
        container.appendChild(stageEl);
      }

      if (block.closingLine) {
        const closing = document.createElement('p');
        closing.className = 'diag-closing';
        closing.innerHTML = mdInline(block.closingLine);
        container.appendChild(closing);
      }
    }

    render();
  }

  /* =========================================================
     Test de Limitación Articular Funcional, diario y ficha
     ---------------------------------------------------------
     Bloques propios de este libro. El test guarda cada registro en el
     dispositivo del lector (localStorage, clave "ft_records"); el diario y
     la ficha leen de ahí. No calcula índices ni categorías: muestra el
     dolor informado, las seis respuestas y su suma (solo si está completa).
     Los textos se pueden cambiar desde el bloque en content.json (mismas
     claves que FT_DEFAULTS).
     ========================================================= */
  const FT_DEFAULTS = {
    moments: ['Inicial', '1 mes', '3 meses', '6 meses', '12 meses'],
    otherMoment: 'Otro momento',
    painQuestion: 'Considerando tus medicamentos, ¿qué nivel de dolor sentiste en las últimas 48 horas?',
    painMin: '0 · sin dolor',
    painMax: '100 · el peor dolor imaginable',
    medsQuestion: '¿Tomaste analgésicos o antiinflamatorios para estas molestias en las últimas 48 horas?',
    medsDetailLabel: 'Nombre, dosis que tenés indicada y cuándo los tomaste',
    reliefQuestion: '¿Qué porcentaje de alivio estimás que te da la medicación?',
    questionsHint: 'Pensá en los últimos dos días y elegí una respuesta para cada pregunta.',
    questions: [
      'Al caminar por un terreno llano, ¿qué nivel de dolor sentís?',
      '¿Cuánto dolor sentís por la noche, estando acostado?',
      '¿Cuánta rigidez notás después de despertarte por la mañana?',
      '¿Qué grado de dificultad tenés al subir o bajar escaleras?',
      '¿Qué grado de dificultad tenés al levantarte después de estar sentado?',
      '¿Qué grado de dificultad tenés al ponerte las medias o los calcetines?',
    ],
    options: ['Ninguno', 'Poco', 'Bastante', 'Mucho', 'Muchísimo'],
    naLabel: 'No puedo responderla (no ocurrió o no describe mi situación)',
    notesLabel: 'Observaciones',
    notesPlaceholder: 'Actividades que no ocurrieron, preguntas difíciles de responder, cambios en tu rutina…',
    saveNote: 'Se guarda solo en este dispositivo. No reemplaza una consulta ni un diagnóstico.',
    resultText: 'Este registro resume las molestias y dificultades que informaste. No identifica su causa ni indica qué tratamiento necesitás. Guardalo para conversar con tu médico y comparar tu evolución.',
    incompleteText: 'Sin suma: quedó al menos una pregunta sin responder. Una respuesta faltante no se cuenta como cero; comentala con el médico.',
    emailHeading: 'Recibir una copia por correo',
    emailText: 'Si querés, te enviamos este registro a tu correo.',
  };

  function ftRecords() {
    const list = lsGet('ft_records', []);
    return Array.isArray(list) ? list : [];
  }
  function ftSaveRecords(list) {
    lsSet('ft_records', list);
    document.dispatchEvent(new CustomEvent('ft:changed'));
  }
  // Suma de las seis respuestas; null si falta alguna (no se cuenta como cero).
  function ftSum(rec) {
    const a = (rec && rec.answers) || [];
    return a.length && a.every(v => typeof v === 'number') ? a.reduce((x, y) => x + y, 0) : null;
  }
  function ftMax(rec) { return ((rec && rec.answers) || []).length * 4; }
  function ftToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function ftDateText(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
  }
  function ftMedsText(rec) {
    if (rec.meds === 'no') return 'No tomé analgésicos ni antiinflamatorios.';
    let s = (rec.medsDetail || '').trim() || 'Sí (sin detalle)';
    if (!/[.!?…]$/.test(s)) s += '.';
    if (rec.relief === 'pct') s += ` Alivio estimado: ${rec.reliefPct}%.`;
    else if (rec.relief === 'none') s += ' No percibo alivio.';
    else if (rec.relief === 'unknown') s += ' No sé estimar el alivio.';
    return s;
  }
  function ftAnswersText(rec) {
    return ((rec && rec.answers) || []).map((v, i) => `${i + 1}: ${typeof v === 'number' ? v : '—'}`).join(' · ');
  }
  // Registro de referencia: el "Inicial" más reciente o, si no hay, el primero.
  function ftBaseline() {
    const recs = ftRecords();
    const initial = recs.filter(r => r.moment === FT_DEFAULTS.moments[0]);
    return initial[initial.length - 1] || recs[0] || null;
  }
  function leadsEnabledFor(type) {
    const c = leadsConfig();
    const ej = c.emailjs;
    return !!((ej && ej.serviceId && ej.publicKey && ej.templates && ej.templates[type]) || (c.webhook && c.webhook.url));
  }
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  // Imprime solo un bloque del capítulo (el registro o el diario).
  function printBlock(node) {
    document.body.classList.add('print-focus');
    node.classList.add('print-target');
    const done = () => {
      document.body.classList.remove('print-focus');
      node.classList.remove('print-target');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  }
  function autoGrow(textarea) {
    const fit = () => { textarea.style.height = 'auto'; textarea.style.height = (textarea.scrollHeight + 2) + 'px'; };
    textarea.addEventListener('input', fit);
    requestAnimationFrame(fit);
  }

  function mountFunctionalTest(container, block) {
    const cfg = Object.assign({}, FT_DEFAULTS, block);
    const questions = cfg.questions;
    const draftKey = 'ft_draft_' + block.id;
    const state = { view: 'form', record: null };

    function newDraft() {
      const recs = ftRecords();
      const last = recs[recs.length - 1] || {};
      const used = new Set(recs.map(r => r.moment));
      const moment = (cfg.defaultMoment && !used.has(cfg.defaultMoment))
        ? cfg.defaultMoment
        : (cfg.moments.find(m => !used.has(m)) || cfg.otherMoment);
      return { date: ftToday(), moment, zone: last.zone || '', activity: last.activity || '', pain: null,
        meds: null, medsDetail: '', relief: null, reliefPct: null, answers: questions.map(() => null), notes: '' };
    }

    let draft = lsGet(draftKey, null);
    if (!draft || !Array.isArray(draft.answers) || draft.answers.length !== questions.length) {
      draft = newDraft();
      if (ftRecords().length) state.view = 'summary';
    }
    const saveDraft = () => lsSet(draftKey, draft);

    function header() {
      container.appendChild(el('p', 'diag-eyebrow', cfg.eyebrow || 'Test funcional'));
      const title = el('h3', 'diag-title');
      title.innerHTML = mdInline(cfg.title || 'Registrar cómo me siento');
      container.appendChild(title);
    }

    function render() {
      container.innerHTML = '';
      header();
      if (state.view === 'summary') renderSummary();
      else if (state.view === 'result') renderResult(state.record);
      else renderForm();
    }
    function show(view, record) {
      state.view = view;
      state.record = record || null;
      render();
      if (container.getBoundingClientRect().top < 0) container.scrollIntoView({ block: 'start' });
    }

    // Grupo de botones de opción única.
    function choiceGroup(className, labels, values, current, onPick) {
      const group = el('div', className);
      group.setAttribute('role', 'group');
      values.forEach((val, i) => {
        const btn = el('button', null, labels[i]);
        btn.type = 'button';
        if (val === 'na') btn.classList.add('ft-na');
        btn.classList.toggle('selected', current === val);
        btn.setAttribute('aria-pressed', String(current === val));
        btn.addEventListener('click', () => {
          group.querySelectorAll('button').forEach(b => {
            b.classList.toggle('selected', b === btn);
            b.setAttribute('aria-pressed', String(b === btn));
          });
          onPick(val);
        });
        group.appendChild(btn);
      });
      return group;
    }
    function field(labelText, input) {
      const label = el('label', 'ft-field');
      label.appendChild(el('span', 'ft-field-label', labelText));
      label.appendChild(input);
      return label;
    }
    function textInput(type, value, placeholder, onInput) {
      const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') input.type = type;
      input.value = value || '';
      if (placeholder) input.placeholder = placeholder;
      input.addEventListener('input', () => { onInput(input.value); saveDraft(); });
      if (type === 'textarea') autoGrow(input);
      return input;
    }

    function renderSummary() {
      const recs = ftRecords();
      const last = recs[recs.length - 1];
      const sum = ftSum(last);
      const p = el('p', 'ft-intro');
      p.textContent = `Tu último registro: ${ftDateText(last.date)} · ${last.moment} · dolor ${last.pain}/100` +
        (sum === null ? '' : ` · cuestionario ${sum}/${ftMax(last)}`) + '.';
      container.appendChild(p);
      const actions = el('div', 'ft-actions');
      const again = el('button', 'btn btn-primary', 'Hacer un nuevo registro');
      again.type = 'button';
      again.addEventListener('click', () => show('form'));
      const see = el('button', 'btn btn-ghost', 'Ver mi último registro');
      see.type = 'button';
      see.addEventListener('click', () => show('result', last));
      actions.appendChild(again);
      actions.appendChild(see);
      container.appendChild(actions);
    }

    function renderForm() {
      if (cfg.intro) container.appendChild(el('p', 'ft-intro', cfg.intro));

      // Datos del registro
      const base = el('div', 'ft-grid');
      base.appendChild(field('Fecha', textInput('date', draft.date, '', v => { draft.date = v; })));
      const select = document.createElement('select');
      cfg.moments.concat([cfg.otherMoment]).forEach(m => {
        const opt = el('option', null, m);
        opt.value = m;
        opt.selected = m === draft.moment;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => { draft.moment = select.value; saveDraft(); });
      base.appendChild(field('Momento', select));
      container.appendChild(base);
      container.appendChild(field('Zona o articulación que querés evaluar',
        textInput('text', draft.zone, 'Por ejemplo: rodilla derecha', v => { draft.zone = v; })));
      container.appendChild(field('Actividad que querés recuperar',
        textInput('text', draft.activity, 'Por ejemplo: levantarme de la silla con más comodidad', v => { draft.activity = v; })));

      // Paso 1: dolor. La barra no cuenta como respuesta hasta que se toca.
      container.appendChild(el('h4', 'ft-step', 'Paso 1 · Intensidad del dolor'));
      container.appendChild(el('p', 'ft-question', cfg.painQuestion));
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '0'; range.max = '100'; range.step = '1';
      range.value = draft.pain === null ? '50' : String(draft.pain);
      range.className = 'ft-range' + (draft.pain === null ? ' untouched' : '');
      range.setAttribute('aria-label', cfg.painQuestion);
      const out = el('output', 'ft-range-value');
      const paintPain = () => { out.textContent = draft.pain === null ? 'Mové la barra para elegir un valor' : `${draft.pain} /100`; };
      const pickPain = () => { draft.pain = Number(range.value); range.classList.remove('untouched'); paintPain(); saveDraft(); };
      ['input', 'change', 'pointerup'].forEach(evt => range.addEventListener(evt, pickPain));
      paintPain();
      container.appendChild(range);
      const ends = el('div', 'ft-range-ends');
      ends.appendChild(el('span', null, cfg.painMin));
      ends.appendChild(el('span', null, cfg.painMax));
      container.appendChild(ends);
      container.appendChild(out);

      // Paso 2: medicación
      container.appendChild(el('h4', 'ft-step', 'Paso 2 · Medicación'));
      container.appendChild(el('p', 'ft-question', cfg.medsQuestion));
      const medsExtra = el('div', 'ft-sub');
      const reliefWrap = el('div', 'ft-sub');
      container.appendChild(choiceGroup('ft-choices', ['Sí', 'No'], ['si', 'no'], draft.meds, val => {
        draft.meds = val;
        medsExtra.hidden = val !== 'si';
        saveDraft();
      }));
      medsExtra.hidden = draft.meds !== 'si';
      medsExtra.appendChild(field(cfg.medsDetailLabel, textInput('textarea', draft.medsDetail, '', v => { draft.medsDetail = v; })));
      medsExtra.appendChild(el('p', 'ft-question', cfg.reliefQuestion));
      medsExtra.appendChild(choiceGroup('ft-choices',
        ['Puedo estimarlo', 'No percibo alivio', 'No sé estimarlo'], ['pct', 'none', 'unknown'], draft.relief, val => {
          draft.relief = val;
          reliefWrap.hidden = val !== 'pct';
          if (val === 'pct' && draft.reliefPct === null) { draft.reliefPct = Number(relief.value); paintRelief(); }
          saveDraft();
        }));
      const relief = document.createElement('input');
      relief.type = 'range';
      relief.min = '0'; relief.max = '100'; relief.step = '5';
      relief.value = draft.reliefPct === null ? '50' : String(draft.reliefPct);
      relief.className = 'ft-range';
      relief.setAttribute('aria-label', cfg.reliefQuestion);
      const reliefOut = el('output', 'ft-range-value');
      const paintRelief = () => { reliefOut.textContent = draft.reliefPct === null ? '' : `${draft.reliefPct}% de alivio estimado`; };
      relief.addEventListener('input', () => { draft.reliefPct = Number(relief.value); paintRelief(); saveDraft(); });
      paintRelief();
      reliefWrap.hidden = draft.relief !== 'pct';
      reliefWrap.appendChild(relief);
      reliefWrap.appendChild(reliefOut);
      medsExtra.appendChild(reliefWrap);
      container.appendChild(medsExtra);

      // Paso 3: las seis preguntas
      container.appendChild(el('h4', 'ft-step', `Paso 3 · Las ${questions.length} preguntas`));
      container.appendChild(el('p', 'ft-hint', cfg.questionsHint));
      const optionLabels = cfg.options.map((o, i) => `${o} · ${i}`).concat([cfg.naLabel]);
      const optionValues = cfg.options.map((o, i) => i).concat(['na']);
      questions.forEach((q, qi) => {
        const item = el('div', 'diag-item');
        item.appendChild(el('p', 'diag-item-text', `${qi + 1}. ${q}`));
        const group = choiceGroup('diag-scale ft-scale', optionLabels, optionValues, draft.answers[qi], val => {
          draft.answers[qi] = val;
          saveDraft();
        });
        group.style.setProperty('--scale-cols', String(cfg.options.length));
        group.setAttribute('aria-label', q);
        item.appendChild(group);
        container.appendChild(item);
      });

      container.appendChild(field(cfg.notesLabel, textInput('textarea', draft.notes, cfg.notesPlaceholder, v => { draft.notes = v; })));

      const error = el('p', 'ft-error');
      error.setAttribute('role', 'alert');
      error.hidden = true;
      container.appendChild(error);

      const actions = el('div', 'ft-actions');
      const save = el('button', 'btn btn-primary', 'Guardar mi registro');
      save.type = 'button';
      save.addEventListener('click', () => {
        const missing = [];
        if (!draft.date) missing.push('la fecha');
        if (!(draft.zone || '').trim()) missing.push('la zona o articulación');
        if (draft.pain === null) missing.push('la intensidad del dolor (mové la barra)');
        if (draft.meds === null) missing.push('si tomaste medicación');
        if (draft.meds === 'si' && draft.relief === null) missing.push('el alivio que estimás (o indicá que no sabés)');
        const open = draft.answers.filter(v => v === null).length;
        if (open) missing.push(`${open} ${open === 1 ? 'pregunta' : 'preguntas'} del cuestionario (si no podés responder alguna, marcá esa opción)`);
        if (missing.length) {
          error.textContent = 'Falta completar: ' + missing.join('; ') + '.';
          error.hidden = false;
          return;
        }
        const record = Object.assign({ id: Date.now() }, draft, { zone: draft.zone.trim(), activity: (draft.activity || '').trim() });
        if (record.meds !== 'si') { record.medsDetail = ''; record.relief = null; record.reliefPct = null; }
        if (record.relief !== 'pct') record.reliefPct = null;
        ftSaveRecords(ftRecords().concat([record]));
        try { localStorage.removeItem(STORAGE_PREFIX + draftKey); } catch (e) { /* sin almacenamiento */ }
        draft = newDraft();
        show('result', record);
        showToast('Registro guardado en este dispositivo.');
      });
      actions.appendChild(save);
      container.appendChild(actions);
      container.appendChild(el('span', 'save-note', cfg.saveNote));
    }

    function answerLabel(v) {
      if (typeof v !== 'number') return 'Sin responder';
      return `${cfg.options[v]} (${v})`;
    }

    // Variables para la plantilla de correo (EmailJS) o el webhook.
    function recordParams(rec) {
      const sum = ftSum(rec);
      const params = {
        test_title: plain(cfg.eyebrow || cfg.title), record_date: ftDateText(rec.date), record_moment: rec.moment,
        record_zone: rec.zone, record_activity: rec.activity || '—', pain: rec.pain,
        sum_text: sum === null ? 'Incompleta (no se calcula)' : `${sum} de ${ftMax(rec)}`,
        meds_text: ftMedsText(rec), notes: rec.notes || '—', result_text: cfg.resultText,
        image_hero: absUrl((block.email || {}).heroImage || (book.meta || {}).coverImage),
        cta_text: (block.email || {}).ctaText || 'Volver al libro', cta_url: absUrl('./'),
      };
      questions.forEach((q, i) => {
        params[`q_${i + 1}_text`] = q;
        params[`q_${i + 1}_answer`] = answerLabel(rec.answers[i]);
      });
      return params;
    }

    function renderResult(rec) {
      const sum = ftSum(rec);
      const card = el('div', 'ft-result');
      card.appendChild(el('p', 'ft-result-meta', `${ftDateText(rec.date)} · ${rec.moment} · ${rec.zone}`));
      if (rec.activity) card.appendChild(el('p', 'ft-result-goal', `Actividad que querés recuperar: ${rec.activity}`));

      const figures = el('div', 'ft-figures');
      const pain = el('div', 'ft-figure');
      pain.appendChild(el('span', 'ft-figure-label', 'Dolor percibido'));
      pain.appendChild(el('span', 'ft-figure-value', `${rec.pain} /100`));
      const total = el('div', 'ft-figure');
      total.appendChild(el('span', 'ft-figure-label', 'Cuestionario funcional abreviado'));
      total.appendChild(el('span', 'ft-figure-value', sum === null ? '— /' + ftMax(rec) : `${sum} /${ftMax(rec)}`));
      figures.appendChild(pain);
      figures.appendChild(total);
      card.appendChild(figures);
      if (sum === null) card.appendChild(el('p', 'ft-hint', cfg.incompleteText));

      const list = el('ol', 'ft-answers');
      questions.forEach((q, i) => {
        const li = el('li');
        li.appendChild(el('span', null, q + ' '));
        li.appendChild(el('strong', null, answerLabel(rec.answers[i])));
        list.appendChild(li);
      });
      card.appendChild(list);

      const meds = el('p', 'ft-result-line');
      meds.appendChild(el('strong', null, 'Medicación: '));
      meds.appendChild(document.createTextNode(ftMedsText(rec)));
      card.appendChild(meds);
      if (rec.notes) {
        const notes = el('p', 'ft-result-line');
        notes.appendChild(el('strong', null, 'Observaciones: '));
        notes.appendChild(document.createTextNode(rec.notes));
        card.appendChild(notes);
      }
      card.appendChild(el('p', 'note-block', cfg.resultText));
      container.appendChild(card);

      const actions = el('div', 'ft-actions no-print');
      if (cfg.diaryUrl) {
        const a = el('a', 'btn btn-primary', 'Ver mi diario de evolución');
        a.href = cfg.diaryUrl;
        actions.appendChild(a);
      }
      if (cfg.fichaUrl) {
        const a = el('a', 'btn btn-ghost', 'Completar mi ficha de consulta');
        a.href = cfg.fichaUrl;
        actions.appendChild(a);
      }
      const printBtn = el('button', 'btn btn-ghost', 'Imprimir este registro');
      printBtn.type = 'button';
      printBtn.addEventListener('click', () => printBlock(container));
      actions.appendChild(printBtn);
      const again = el('button', 'btn btn-ghost', 'Hacer otro registro');
      again.type = 'button';
      again.addEventListener('click', () => show('form'));
      actions.appendChild(again);
      container.appendChild(actions);

      // Copia por correo: solo si el envío está configurado (meta.leads).
      if (leadsEnabledFor('registro')) {
        const box = el('div', 'ft-email no-print');
        box.appendChild(el('h4', 'ft-step', cfg.emailHeading));
        box.appendChild(el('p', 'ft-hint', cfg.emailText));
        const form = el('form', 'diag-gate-form');
        form.innerHTML = `
          <input type="text" name="name" placeholder="${escapeHtml(t('diagNamePlaceholder'))}" aria-label="${escapeHtml(t('diagNamePlaceholder'))}" required autocomplete="name" />
          <input type="email" name="email" placeholder="${escapeHtml(t('diagEmailPlaceholder'))}" aria-label="${escapeHtml(t('diagEmailPlaceholder'))}" required autocomplete="email" />
          <button type="submit" class="btn btn-primary">Enviarme la copia</button>
          ${consentHtml()}
        `;
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = form.querySelector('input[name="name"]').value.trim();
          const email = form.querySelector('input[name="email"]').value.trim();
          if (!email) return;
          const btn = form.querySelector('button[type="submit"]');
          btn.disabled = true;
          btn.textContent = t('sending');
          const outcome = await submitLead({ type: 'registro', source: 'registro_' + block.id, name, email,
            consent: readConsent(form), params: recordParams(rec) });
          const sent = outcome.configured && outcome.sent.length > 0;
          box.innerHTML = '';
          box.appendChild(el('p', 'ft-hint', sent
            ? `Listo: enviamos la copia a ${email}.`
            : 'No pudimos enviarla ahora. Tu registro sigue guardado en este dispositivo y volveremos a intentarlo cuando haya conexión.'));
        });
        box.appendChild(form);
        container.appendChild(box);
      }
    }

    render();
  }

  // Diario de evolución: una fila por momento de control, con el registro
  // guardado si existe; debajo, cualquier otro registro.
  function mountDiary(container, block) {
    const cols = block.columns || ['Momento', 'Fecha', 'Dolor /100', 'Cuestionario abreviado /24',
      'Medicación y observaciones', 'Actividad que querés recuperar'];

    function render() {
      container.innerHTML = '';
      const recs = ftRecords();
      const shown = new Set();
      const rows = FT_DEFAULTS.moments.map(moment => {
        const match = recs.filter(r => r.moment === moment);
        const rec = match[match.length - 1] || null;
        if (rec) shown.add(rec.id);
        return { moment, rec };
      });
      recs.filter(r => !shown.has(r.id)).forEach(rec => rows.push({ moment: rec.moment, rec }));

      const wrap = el('div', 'table-block table-stack diary-table');
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      cols.forEach(c => { const th = el('th', null, c); th.scope = 'col'; htr.appendChild(th); });
      thead.appendChild(htr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      rows.forEach(({ moment, rec }) => {
        const tr = document.createElement('tr');
        if (!rec) tr.className = 'diary-empty';
        const cell = (i, text) => {
          const td = el(i === 0 ? 'th' : 'td', null, text);
          if (i === 0) td.scope = 'row';
          td.dataset.label = cols[i];
          tr.appendChild(td);
          return td;
        };
        cell(0, moment);
        if (!rec) {
          for (let i = 1; i < cols.length; i++) cell(i, '—');
        } else {
          const sum = ftSum(rec);
          cell(1, ftDateText(rec.date) + (rec.zone ? ` · ${rec.zone}` : ''));
          cell(2, String(rec.pain));
          const q = cell(3, sum === null ? 'Incompleto' : String(sum));
          q.appendChild(el('small', 'diary-answers', ftAnswersText(rec)));
          cell(4, ftMedsText(rec) + (rec.notes ? ' ' + rec.notes : ''));
          const last = cell(5, rec.activity || '—');
          const del = el('button', 'diary-delete no-print', 'Borrar este registro');
          del.type = 'button';
          del.addEventListener('click', () => {
            if (!window.confirm(`¿Borrar el registro «${rec.moment}» del ${ftDateText(rec.date)}? No se puede deshacer.`)) return;
            ftSaveRecords(ftRecords().filter(r => r.id !== rec.id));
          });
          last.appendChild(del);
        }
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);

      const actions = el('div', 'ft-actions no-print');
      const printBtn = el('button', 'btn btn-ghost', 'Imprimir mi diario');
      printBtn.type = 'button';
      printBtn.addEventListener('click', () => printBlock(container));
      actions.appendChild(printBtn);
      container.appendChild(actions);
      container.appendChild(el('span', 'save-note no-print', recs.length
        ? 'Tus registros se guardan solo en este dispositivo. Si cambiás de teléfono o borrás los datos del navegador, se pierden: imprimilos o anotalos para conservarlos.'
        : 'Todavía no hay registros guardados en este dispositivo. Cuando guardes el test, aparecen acá.'));
    }

    const onChange = () => {
      if (!container.isConnected) { document.removeEventListener('ft:changed', onChange); return; }
      render();
    };
    document.addEventListener('ft:changed', onChange);
    render();
  }

  // Campos de la ficha. Los que tienen "source" proponen el dato del
  // registro de referencia del test mientras el lector no escriba otro.
  function mountFields(container, block) {
    const base = ftBaseline();
    const sum = base ? ftSum(base) : null;
    const source = base ? {
      date: ftDateText(base.date), zone: base.zone, activity: base.activity, pain: String(base.pain),
      answers: (base.answers || []).map(v => (typeof v === 'number' ? v : '—')).join(' / '),
      sum: sum === null ? '' : String(sum), meds: ftMedsText(base), notes: base.notes || '',
    } : {};
    let prefilled = false;
    (block.fields || []).forEach(f => {
      const key = `field_${block.id}_${f.id}`;
      const row = el('label', 'field-row' + (f.short ? ' field-short' : ''));
      row.appendChild(el('span', 'field-label', f.label));
      const input = document.createElement(f.long ? 'textarea' : 'input');
      if (f.long) input.rows = 2; else input.type = 'text';
      let value = lsGet(key, null);
      if (value === null && f.source && source[f.source]) { value = source[f.source]; prefilled = true; }
      input.value = value || '';
      input.addEventListener('input', () => lsSet(key, input.value));
      if (f.long) autoGrow(input);
      const line = el('span', 'field-input');
      line.appendChild(input);
      if (f.suffix) line.appendChild(el('span', 'field-suffix', f.suffix));
      row.appendChild(line);
      container.appendChild(row);
    });
    if (block.prefillNote && prefilled) {
      container.appendChild(el('span', 'save-note no-print',
        `Completamos algunos datos con tu registro «${base.moment}» del ${ftDateText(base.date)}. Podés cambiarlos.`));
    }
  }

  /* ---- Delegación de eventos para los bloques interactivos simples ---- */
  els.chapterBody.addEventListener('input', (e) => {
    const block = e.target.closest('.reflection-block');
    if (block && e.target.tagName === 'TEXTAREA') {
      lsSet('reflection_' + block.dataset.reflectionId, e.target.value);
    }
  });

  els.chapterBody.addEventListener('click', (e) => {
    const optBtn = e.target.closest('.quiz-option');
    if (optBtn) {
      const block = optBtn.closest('.quiz-block');
      const idx = Number(optBtn.dataset.optionIndex);
      block.querySelectorAll('.quiz-option').forEach(b => {
        b.classList.toggle('selected', b === optBtn);
        b.setAttribute('aria-pressed', String(b === optBtn));
      });
      lsSet('quiz_' + block.dataset.quizId, idx);
      const chapter = chapters[currentIndex];
      const quizBlockData = (chapter.blocks || []).find(b => b.id === block.dataset.quizId);
      const feedback = block.querySelector('.quiz-feedback');
      feedback.hidden = false;
      feedback.textContent = (quizBlockData && quizBlockData.feedback) || t('quizFeedback');
    }
  });

  // Nota: este listener es solo para el CTA simple (bloque "cta"). El
  // formulario del diagnóstico usa la clase "diag-gate-form" y maneja su
  // propio submit, así evitamos que ambos se disparen a la vez.
  els.chapterBody.addEventListener('submit', (e) => {
    const form = e.target.closest('.cta-form');
    if (!form) return;
    e.preventDefault();
    const wrap = form.closest('.cta-block');
    if (!wrap) return;
    const email = form.querySelector('input[type="email"]').value.trim();
    if (!email) return;

    // El destino del correo se configura en content.json → meta.leads.
    submitLead({ type: 'cta', source: 'cta_' + wrap.dataset.ctaId, email, consent: readConsent(form),
      params: { chapter_id: chapters[currentIndex].id, chapter_title: chapters[currentIndex].title,
        image_hero: absUrl((book.meta || {}).coverImage) } });

    form.hidden = true;
    const success = wrap.querySelector('.cta-success');
    if (success) success.hidden = false;
    showToast(t('ctaToast'));
  });

  /* ---------------- Navegación entre capítulos ---------------- */
  function goToCover() {
    currentIndex = -1;
    els.cover.hidden = false;
    els.reader.hidden = true;
    // Quita el #capitulo de la URL sin disparar otro render.
    if (location.hash) {
      try { history.pushState(null, '', location.pathname + location.search); }
      catch (e) { location.hash = ''; }
    }
    updateResume();
    updateProgressBar();
    highlightActiveChapter();
    window.scrollTo(0, 0);
  }

  function goToChapter(id, opts = {}) {
    const idx = chapters.findIndex(c => c.id === id);
    if (idx === -1) return;
    currentIndex = idx;
    const chapter = chapters[idx];

    els.cover.hidden = true;
    els.reader.hidden = false;
    renderChapterHero(chapter);
    els.chapterKicker.textContent = chapter.kicker || '';
    els.chapterTitle.textContent = chapter.title;
    renderChapterBody(chapter);
    els.chapterPosition.textContent = `${idx + 1} / ${chapters.length}`;
    els.prevBtn.disabled = false;
    els.nextBtn.textContent = idx === chapters.length - 1 ? t('end') : t('next');

    if (opts.updateHash !== false && location.hash !== '#' + chapter.id) location.hash = chapter.id;

    const visited = getVisited();
    visited.add(chapter.id);
    saveVisited(visited);
    lsSet('lastChapter', chapter.id);

    renderSidebar(); // refresca marcas de "leído" y el capítulo activo
    window.scrollTo(0, 0);
    updateProgressBar();
    // Lleva el foco al título para lectores de pantalla y teclado.
    if (opts.focus !== false) els.chapterTitle.focus({ preventScroll: true });
  }

  // Avance de lectura del libro completo: capítulos ya pasados más lo
  // recorrido (scroll) del capítulo actual.
  function updateProgressBar() {
    let pct = 0;
    if (currentIndex >= 0 && chapters.length) {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const frac = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 1;
      pct = ((currentIndex + frac) / chapters.length) * 100;
    }
    els.progressBar.style.width = pct.toFixed(1) + '%';
  }

  function initScrollProgress() {
    window.addEventListener('scroll', updateProgressBar, { passive: true });
    window.addEventListener('resize', updateProgressBar);
  }

  /* ---------------- Sidebar (menú móvil) ---------------- */
  function openSidebar() {
    els.sidebar.classList.add('open');
    els.sidebarOverlay.hidden = false;
    els.menuToggle.setAttribute('aria-expanded', 'true');
    els.sidebarClose.focus();
  }
  function closeSidebar() {
    const wasOpen = els.sidebar.classList.contains('open');
    els.sidebar.classList.remove('open');
    els.sidebarOverlay.hidden = true;
    els.menuToggle.setAttribute('aria-expanded', 'false');
    return wasOpen;
  }

  /* ---------------- Tema claro/oscuro (opcional) ---------------- */
  function initTheme() {
    if (!els.themeToggle) return; // el libro no tiene toggle: usa un tema fijo
    const saved = lsGet('theme', null);
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    els.themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      lsSet('theme', next);
    });
  }

  /* ---------------- Tamaño de letra de lectura (opcional) ---------------- */
  function initFontSize() {
    let idx = Number(lsGet('fontScale', 0)) || 0;
    if (idx < 0 || idx >= FONT_SCALES.length) idx = 0;
    const apply = () => {
      document.documentElement.style.setProperty('--reading-scale', String(FONT_SCALES[idx]));
      updateProgressBar();
    };
    apply();
    if (!els.fontSizeBtn) return;
    els.fontSizeBtn.addEventListener('click', () => {
      idx = (idx + 1) % FONT_SCALES.length;
      lsSet('fontScale', idx);
      apply();
    });
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function showToast(msg, ms = 3200) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }

  /* ---------------- Estado de conexión ---------------- */
  function initConnectivity() {
    const update = () => { els.offlineBadge.hidden = navigator.onLine; };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  /* ---------------- Instalación como app (PWA) ----------------
     Dos accesos: el ícono de la barra superior (solo cuando el navegador
     ofrece instalación directa) y un botón siempre visible al final del
     índice. Cuando el navegador no permite instalar con un clic (iPhone,
     Safari, Firefox), el botón del índice muestra los pasos a mano. */
  function initInstallPrompt() {
    let deferredPrompt = null;
    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const manualSteps = () => t(isIos ? 'installIos' : isAndroid ? 'installAndroid' : 'installDesktop');

    const setInstalled = () => {
      els.installBtn.hidden = true;
      if (els.sidebarInstall) els.sidebarInstall.hidden = true;
      if (els.installHelp) { els.installHelp.hidden = false; els.installHelp.textContent = t('installDone'); }
    };
    if (els.sidebarInstall) els.sidebarInstall.hidden = isStandalone;
    if (isIos && !isStandalone) els.installBtn.hidden = false;

    const install = async (fromSidebar) => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        deferredPrompt = null;
        els.installBtn.hidden = true;
        if (choice && choice.outcome === 'accepted') setInstalled();
        return;
      }
      if (fromSidebar && els.installHelp) {
        els.installHelp.textContent = manualSteps();
        els.installHelp.hidden = false;
      } else {
        showToast(manualSteps(), 7000);
      }
    };

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      els.installBtn.hidden = false;
    });
    els.installBtn.addEventListener('click', () => install(false));
    if (els.sidebarInstall) els.sidebarInstall.addEventListener('click', () => install(true));
    window.addEventListener('appinstalled', setInstalled);
  }

  /* ---------------- Service worker ---------------- */
  function initServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(() => {
          /* si falla el registro (por ejemplo en file://), la app sigue funcionando online */
        });
      });
    }
  }

  // Pide al service worker que guarde todas las imágenes del libro que ya
  // existan, para que la lectura offline sea completa aunque el lector
  // todavía no haya abierto esos capítulos. Las que faltan se omiten.
  function warmOfflineCache() {
    if (!('serviceWorker' in navigator) || !navigator.onLine) return;
    const urls = new Set();
    if (book.meta && book.meta.coverImage) urls.add(book.meta.coverImage);
    chapters.forEach(ch => {
      const hero = normalizeHero(ch.hero);
      if (hero && hero.src) urls.add(hero.src);
      (ch.blocks || []).forEach(b => { if (b && b.type === 'image' && b.src) urls.add(b.src); });
    });
    if (!urls.size) return;
    navigator.serviceWorker.ready.then(reg => {
      if (reg.active) reg.active.postMessage({ type: 'PRECACHE', urls: Array.from(urls) });
    }).catch(() => { /* sin service worker: no hay nada que precargar */ });
  }

  /* ---------------- Enrutamiento simple por hash ---------------- */
  function initRouting() {
    window.addEventListener('hashchange', () => {
      const id = decodeURIComponent(location.hash.replace('#', ''));
      if (!id) {
        if (currentIndex !== -1) goToCover();
        return;
      }
      // goToChapter ya cambió el hash: no volver a renderizar lo mismo.
      if (chapters[currentIndex] && chapters[currentIndex].id === id) return;
      goToChapter(id, { updateHash: false });
    });
  }

  /* ---------------- Arranque ---------------- */
  async function init() {
    initTheme();
    initFontSize();
    initConnectivity();
    initInstallPrompt();
    initServiceWorker();
    initRouting();
    initScrollProgress();

    els.chapterTitle.setAttribute('tabindex', '-1');
    els.menuToggle.addEventListener('click', openSidebar);
    els.sidebarClose.addEventListener('click', closeSidebar);
    els.sidebarOverlay.addEventListener('click', closeSidebar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && closeSidebar()) els.menuToggle.focus();
    });
    els.startBtn.addEventListener('click', () => { if (chapters.length) goToChapter(chapters[0].id); });
    if (els.resumeBtn) {
      els.resumeBtn.addEventListener('click', () => goToChapter(els.resumeBtn.dataset.chapterId));
    }
    els.prevBtn.addEventListener('click', () => {
      if (currentIndex <= 0) { goToCover(); return; }
      goToChapter(chapters[currentIndex - 1].id);
    });
    els.nextBtn.addEventListener('click', () => {
      if (currentIndex < chapters.length - 1) goToChapter(chapters[currentIndex + 1].id);
      else goToCover(); // el último capítulo devuelve a la portada
    });

    try {
      book = await loadContent();
      chapters = Array.isArray(book.chapters) ? book.chapters : [];
      ui = Object.assign({}, UI_DEFAULTS, (book.meta && book.meta.ui) || {});
    } catch (err) {
      els.chapterBody.innerHTML = '';
      els.coverTitle.textContent = t('loadErrorTitle');
      els.coverSubtitle.textContent = t('loadErrorText');
      els.startBtn.hidden = true;
      console.error(err);
      return;
    }

    computeChapterLabels();
    if (els.sidebarInstall) (els.sidebarInstall.querySelector('span') || els.sidebarInstall).textContent = t('install');
    renderCover();
    renderSidebar();
    retryPendingLeads();
    window.addEventListener('online', retryPendingLeads);

    const hashId = decodeURIComponent(location.hash.replace('#', ''));
    if (hashId && chapters.some(c => c.id === hashId)) {
      goToChapter(hashId, { updateHash: false, focus: false });
    } else {
      goToCover();
    }

    warmOfflineCache();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
