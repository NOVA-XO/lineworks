/* =============================================================================
   Профайлын дүрслэл — layout нь Astra-гийнх (gpt-6-astra, 2026-10-08), өгөгдөл нь
   profile-model.js. Хэрэглэгчийн бичсэн текстийг зөвхөн textContent/el-ээр оруулна.
   ========================================================================== */
import {
  $, el, show, copy, download, formatMachine, date,
  EDITION_MN, ROLE_MN,
} from './portal.js';

const STATE_MN = {
  active: 'Идэвхтэй',
  expiring: 'Дуусах дөхсөн',
  expired: 'Хугацаа дууссан',
  revoked: 'Цуцлагдсан',
  future: 'Хүчинтэй болох болоогүй',
  pending: 'Хүсэлт хүлээгдэж буй',
  none: 'Лицензгүй',
};

const initializedPanels = new WeakSet();

function text(value, fallback = '—') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function stateOf(value) {
  return Object.hasOwn(STATE_MN, value) ? value : 'none';
}

function pill(value) {
  const state = stateOf(value);
  return el('span', {
    class: `status ${state}`,
    'data-state': state,
  }, STATE_MN[state]);
}

function edition(licence) {
  // «Prime» хэвээр: plugin, суулгагч, сайт, админ бүгд ингэж бичдэг (Claude, 2026-10-08).
  return EDITION_MN[licence.edition] ?? 'Тодорхойгүй төрөл';
}

function expiry(licence) {
  return licence.perpetual
    ? 'Хугацаагүй'
    : text(date(licence.valid_until));
}

function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2)
    .map(word => Array.from(word)[0])
    .join('')
    .toLocaleUpperCase('mn-MN') || '?';
}

function button(label, onclick, attrs = {}) {
  return el('button', {
    class: 'btn btn-line',
    type: 'button',
    onclick,
    ...attrs,
  }, label);
}

function fact(label, value, mono = false) {
  return el('div', {},
    el('dt', {}, label),
    el('dd', mono ? { class: 'profile-mono' } : {}, value),
  );
}

function message() {
  return el('p', {
    class: 'msg',
    role: 'status',
    'aria-atomic': 'true',
  });
}

function requestButton(label, actions, machineId, renewalLicenceId) {
  return button(label, () => {
    actions.openRequest(machineId, renewalLicenceId);
  });
}

function remainingLabel(licence) {
  switch (licence.state) {
    case 'revoked':
      return 'Цуцлагдсан — ашиглах эрхгүй';
    case 'expired':
      return 'Хугацаа дууссан · 0 хоног үлдсэн';
    case 'future':
      return `${text(date(licence.valid_from))}-ээс хүчинтэй`;
    default:
      return licence.perpetual
        ? 'Хугацааны хязгааргүй'
        : `${licence.daysLeft} хоног үлдсэн`;
  }
}

function tokenView(licence) {
  const token = String(licence.license_text ?? '');
  const hasToken = token.trim().length > 0;
  const masked = hasToken ? text(licence.masked, '••••••••') : 'Токен алга.';
  let revealed = false;

  const output = el('pre', {
    id: 'profile-token-value',
    class: 'profile-mono',
    tabindex: '0',
    'aria-label': 'Лицензийн токен, нууцалсан',
  }, masked);

  const toggle = button('Харуулах', () => {
    revealed = !revealed;

    // Нуух үед бүтэн токен DOM-д үлдэхгүй.
    output.textContent = revealed ? token : masked;
    output.setAttribute(
      'aria-label',
      revealed ? 'Лицензийн бүтэн токен' : 'Лицензийн токен, нууцалсан',
    );
    toggle.textContent = revealed ? 'Нуух' : 'Харуулах';
    toggle.setAttribute('aria-expanded', String(revealed));
  }, {
    'aria-controls': 'profile-token-value',
    'aria-expanded': 'false',
    disabled: !hasToken,
  });

  const msg = message();

  return el('div', { class: 'profile-token' },
    el('h4', {}, 'Лицензийн токен'),
    el('p', { class: 'profile-muted' },
      'Дэлгэц хуваалцах үед хувийн мэдээлэл ил гарахаас сэргийлж нууцалсан.',
    ),
    output,
    el('div', { class: 'actions' },
      toggle,
      button('Хуулах', () => copy(token, msg), {
        disabled: !hasToken,
        'aria-label': 'Гол лицензийн токеныг хуулах',
      }),
      button('.lic татах', () => {
        download(`${licence.no}.lic`, token + '\n');
      }, {
        disabled: !hasToken,
        'aria-label': 'Гол лицензийг .lic файлаар татах',
      }),
    ),
    msg,
  );
}

function primaryView(model, actions) {
  const licence = model.primary;

  if (!licence) {
    const card = el('div', { class: 'profile-license' },
      el('h4', {}, 'Танд лиценз алга'),
      el('p', { class: 'profile-muted' },
        'Компьютерийн дугаараа оруулаад лиценз хүснэ үү.',
      ),
    );

    if (model.pendingCount > 0) {
      card.append(el('p', {}, `${model.pendingCount} хүсэлт хүлээгдэж байна.`));
    }

    card.append(requestButton('Лиценз хүсэх', actions));
    return card;
  }

  const state = stateOf(licence.state);
  const type = el('div', { class: 'profile-license-type' },
    el('strong', {}, edition(licence)),
  );

  if (licence.perpetual) {
    type.append(el('span', {
      class: 'status profile-perpetual',
    }, 'Хугацаагүй'));
  }

  const card = el('div', {
    class: 'profile-license',
    'data-state': state,
  },
    el('div', { class: 'profile-card-head' },
      el('h4', {}, 'Гол лиценз'),
      pill(state),
    ),
    type,
    el('p', { class: 'profile-mono' }, text(licence.no)),
    el('dl', { class: 'profile-facts' },
      fact('Хүчинтэй болох огноо', text(date(licence.valid_from))),
      fact('Дуусах огноо', expiry(licence)),
      fact('Компьютер', text(formatMachine(licence.machine_id)), true),
    ),
    el('p', { class: 'profile-remaining' }, remainingLabel(licence)),
  );

  // Хугацаагүй, ирээдүйн, цуцлагдсан лицензэд төөрөгдүүлэх мөр үзүүлэхгүй.
  if (!licence.perpetual && (
    state === 'active' || state === 'expiring' || state === 'expired'
  )) {
    const raw = Number(licence.remaining);
    const remaining = Number.isFinite(raw)
      ? Math.min(1, Math.max(0, raw))
      : 0;
    const percent = Math.round(remaining * 1000) / 10;

    const fill = el('span');
    fill.style.width = `${percent}%`;

    card.append(el('div', {
      class: 'profile-meter',
      role: 'meter',
      'aria-label': 'Лицензийн хугацааны үлдсэн хувь',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(percent),
      'aria-valuetext': `${licence.daysLeft} хоног үлдсэн`,
    }, fill));
  }

  if (state === 'expiring') {
    const warning = licence.daysLeft < 30
      ? '30 хоногоос бага — сунгах хүсэлт гаргана уу.'
      : '30 хоног үлдсэн — сунгах хүсэлт гаргана уу.';

    card.append(el('div', { class: 'profile-notice' },
      el('p', {}, warning),
      requestButton(
        'Сунгах хүсэлт гаргах',
        actions,
        licence.machine_id,
        licence.id,
      ),
    ));
  } else if (state === 'expired' || state === 'revoked') {
    const renewalId = state === 'expired' && !licence.perpetual
      ? licence.id
      : undefined;

    card.append(el('div', { class: 'profile-notice' },
      requestButton(
        state === 'expired' ? 'Сунгах хүсэлт гаргах' : 'Лиценз хүсэх',
        actions,
        licence.machine_id,
        renewalId,
      ),
    ));
  }

  card.append(tokenView(licence));
  return card;
}

function machineView(machine, actions) {
  const licence = machine.licence;
  const machineId = text(formatMachine(machine.machine_id));
  const state = stateOf(machine.state);

  const head = el('div', { class: 'profile-card-head' },
    el('strong', { class: 'profile-mono' }, machineId),
  );

  if (machine.isCurrent) {
    head.append(el('span', {
      class: 'status profile-perpetual',
    }, 'Энэ компьютер'));
  }

  head.append(pill(state));

  const row = el('li', {
    class: 'profile-machine',
    'data-current': String(Boolean(machine.isCurrent)),
  }, head);

  if (licence) {
    row.append(el('p', {},
      `${edition(licence)} · Дуусах: ${expiry(licence)}`,
    ));

    if (state === 'future') {
      row.append(el('p', { class: 'profile-muted' },
        `${text(date(licence.valid_from))}-ээс хүчинтэй`,
      ));
    }
  } else {
    row.append(el('p', { class: 'profile-muted' }, 'Олгосон лиценз алга.'));
  }

  row.append(el('dl', { class: 'profile-facts' },
    fact('Лицензийн тоо', machine.licences),
    fact('Хүлээгдэж буй хүсэлт', machine.pending),
    fact('Сүүлийн бүртгэл', text(date(machine.lastSeen))),
  ));

  const controls = el('div', { class: 'actions' });
  const msg = message();

  if (licence) {
    const token = String(licence.license_text ?? '');
    controls.append(button('Хуулах', () => copy(token, msg), {
      disabled: !token.trim(),
      'aria-label': `${machineId} компьютерийн лицензийн токеныг хуулах`,
    }));
  }

  if (!licence || state === 'expired' || state === 'revoked') {
    const renewalId = licence && state === 'expired' && !licence.perpetual
      ? licence.id
      : undefined;

    controls.append(requestButton(
      'Хүсэлт гаргах',
      actions,
      machine.machine_id,
      renewalId,
    ));
  }

  if (controls.childElementCount) {
    row.append(controls, msg);
  }

  return row;
}

/**
 * Өгөгдөл татахгүй, форм илгээхгүй.
 * Формын утгуудыг account.js хариуцна.
 *
 * @param {ReturnType<import('./profile-model.js').profileModel>} model
 * @param {{openRequest: (
 *   machineId?: string,
 *   renewalLicenceId?: number|string
 * ) => void}} actions
 */
export function renderProfile(model, actions) {
  const root = $('#profile-panel');
  if (!root) {
    throw new Error('Профайлын хэсэг олдсонгүй.');
  }
  if (typeof actions?.openRequest !== 'function') {
    throw new TypeError('Хүсэлт нээх үйлдэл холбоогүй байна.');
  }

  const find = selector => $(selector, root);
  const firstRender = !initializedPanels.has(root);

  find('#profile-avatar').textContent = initials(model.name);
  find('#profile-name').textContent = text(model.name, 'Нэрээ оруулна уу');
  find('#profile-organization').textContent =
    text(model.organization, 'Байгууллага оруулаагүй');
  find('#profile-email').textContent = text(model.email, 'Имэйл бүртгэгдээгүй');
  find('#profile-role').textContent = ROLE_MN[model.role] ?? 'Тодорхойгүй эрх';
  find('#profile-since').textContent =
    `Бүртгүүлсэн: ${text(date(model.since))}`;

  show(find('#profile-required'), !model.complete);

  const editor = find('#profile-editor');
  const edit = find('#profile-edit');

  function setEditor(open, focus = false) {
    show(editor, open);
    edit.textContent = open ? 'Хаах' : 'Засах';
    edit.setAttribute('aria-expanded', String(open));

    if (open && focus) {
      find('#full-name').focus();
    }
  }

  // Давтан дүрслэлт засварлаж буй формыг хаахгүй, утгыг солихгүй.
  if (firstRender || !model.complete) {
    setEditor(!model.complete);
  } else {
    setEditor(!editor.hidden);
  }

  edit.disabled = false;

  // Давтан render хийхэд listener давхардахгүй.
  edit.onclick = () => {
    setEditor(editor.hidden, editor.hidden);
  };

  find('#profile-primary').replaceChildren(primaryView(model, actions));

  find('#profile-stats').replaceChildren(
    fact('Идэвхтэй лиценз', model.activeCount),
    fact('Бүртгэлтэй компьютер', model.machines.length),
    fact('Хүлээгдэж буй хүсэлт', model.pendingCount),
  );

  find('#profile-machine-list').replaceChildren(
    ...(model.machines.length
      ? model.machines.map(machine => machineView(machine, actions))
      : [el('li', { class: 'profile-muted' },
          'Бүртгэлтэй компьютер алга. Лиценз хүсэхэд энд нэмэгдэнэ.',
        )]),
  );

  initializedPanels.add(root);
}
