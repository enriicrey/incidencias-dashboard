// /api/webhook-respuesta.js

const MAKE_WEBHOOK_RESPUESTA = process.env.MAKE_WEBHOOK_RESPUESTA || '';
const MAKE_WEBHOOK_REGEX = /^https:\/\/hook\.eu\d+\.make\.com\/.+/;
const MAKE_WEBHOOK_VALID = MAKE_WEBHOOK_REGEX.test(MAKE_WEBHOOK_RESPUESTA);

if (!MAKE_WEBHOOK_VALID) {
   console.error(
    '[webhook-respuesta] MAKE_WEBHOOK_RESPUESTA inválida:',
    MAKE_WEBHOOK_RESPUESTA
  );
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Solo se permite POST' });
  }
  if (!MAKE_WEBHOOK_VALID) {
    console.error(
      '[webhook-respuesta] MAKE_WEBHOOK_RESPUESTA inválida:',
      MAKE_WEBHOOK_RESPUESTA
    );
    return res.status(500).json({
      status: 'error',
      message: 'Variable MAKE_WEBHOOK_RESPUESTA inválida. Debe seguir el formato https://hook.euX.make.com/...'
    });
  }

  // 🔽🔽🔽 AÑADE este helper para garantizar body JSON en Node (Vercel) 🔽🔽🔽
  async function readJSONBody(req) {
    if (req.method !== 'POST') return {};
    if (req.body && typeof req.body === 'object') return req.body; // ya parseado
    const raw = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', c => (data += c));
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  }

  try {
    const data = await readJSONBody(req);
    const { action } = data || {};
    if (!action) {
      return res.status(400).json({ status: 'error', message: 'Falta parámetro action' });
    }

    // ------- Construcción payload a Make (idéntico a tu versión) -------
    const ip =
      (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.socket?.remoteAddress || req.connection?.remoteAddress || '';

    const formatNameFromEmail = (email) =>
      (email || '').split('@')[0]?.split('.').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || '';

    const norm = { ...data };
    if (Array.isArray(norm.materiales) && !norm.materials_requested) {
      norm.materials_requested = norm.materiales.map(m => ({
        name: m.nombre,
        quantity: Number(m.cantidad) || 1,
        type: m.tipo,
        urgency: m.urgencia || 'normal',
        justification: m.justificacion || ''
      }));
    }
    if (typeof norm.materials_used === 'string') {
      norm.materials_used = norm.materials_used
        .split(',').map(s => s.trim()).filter(Boolean)
        .map(x => ({ materialName: x, quantity: 1 }));
    }
    if (norm.description && !norm.help_description) norm.help_description = norm.description;
    if (norm.description && !norm.information_content) norm.information_content = norm.description;
    if (typeof norm.read_only === 'string') norm.read_only = norm.read_only === 'true';
    if (typeof norm.work_can_continue === 'string') norm.work_can_continue = norm.work_can_continue === 'true';

    Object.assign(data, norm);

    let makePayload = {
      timestamp: new Date().toISOString(),
      action: data.action,
      incident_id: data.incident_id,
      technician_email: data.technician_email,
      technician_name: data.technician_name || formatNameFromEmail(data.technician_email),
      level: data.level || 'L0',
      user_agent: req.headers['user-agent'],
      ip_address: ip,
    };

    switch (data.action) {
      case 'acepto':
      case 'rechazo':
        makePayload.pin = data.pin || '';
        makePayload.reason = data.reason || data.reject_reason;
        makePayload.escalation_level = Number.isFinite(+data.escalation_level) ? +data.escalation_level : 0;
        if (data.notify_next !== undefined) makePayload.notify_next = data.notify_next;
        break;
      case 'resolver':
        if (!data.solution_description || !data.time_invested) {
          return res.status(400).json({ status: 'error', message: 'solution_description y time_invested son obligatorios' });
        }
        makePayload.pin = data.pin || '';
        makePayload.solution_description = data.solution_description;
        makePayload.time_invested = data.time_invested;
        makePayload.preventive_actions = data.preventive_actions || '';
        makePayload.materials_used = Array.isArray(data.materials_used) ? data.materials_used : (data.materials_used || []);
        if (Array.isArray(makePayload.materials_used)) {
          makePayload.materials_count = makePayload.materials_used.length;
          makePayload.materials_summary = makePayload.materials_used
            .map(m => `${m.materialName || m.nombre || 'Material'} (${m.quantity || m.cantidad || 1})`)
            .join(', ');
        }
        break;
      case 'solicitar_materiales': {
        const list = Array.isArray(data.materials_requested) ? data.materials_requested : [];
        if (!list.length) {
          return res.status(400).json({ status: 'error', message: 'materials_requested debe ser un array con al menos un material' });
        }
        makePayload.pin = data.pin || '';
        makePayload.materials_requested = list;
        makePayload.work_can_continue = !!data.work_can_continue;
        makePayload.impact_if_delayed = data.impact_if_delayed || 'Sin impacto especificado';
        makePayload.materials_count = list.length;
        makePayload.urgency_levels = list.map(m => m.urgencia || m.urgency || 'normal').join(',');
        break;
      }
      case 'derivar_departamento':
        if (!data.target_department || !data.derivation_reason) {
          return res.status(400).json({ status: 'error', message: 'target_department y derivation_reason son obligatorios' });
        }
        makePayload.pin = data.pin || '';
        makePayload.current_department = data.current_department || '';
        makePayload.target_department = data.target_department;
        makePayload.derivation_reason = data.derivation_reason;
        makePayload.technical_notes = data.technical_notes || '';
        break;
      case 'ayuda':
        if (!data.help_type || !data.help_description) {
          return res.status(400).json({ status: 'error', message: 'help_type y help_description son obligatorios' });
        }
        makePayload.pin = data.pin || '';
        makePayload.help_type = data.help_type;
        makePayload.help_description = data.help_description;
        makePayload.urgency = data.urgency || 'media';
        break;
      case 'solicitar_asignacion':
        makePayload.pin = data.pin || '';
        makePayload.request_reason = data.request_reason || '';
        makePayload.request_justification = data.request_justification || '';
        break;
      case 'notes':
        makePayload.pin = data.pin || '';
        makePayload.description = data.description || '';
        break;
      case 'validate_pin':
        makePayload.pin = data.pin || '';
        break;
      case 'get_assigned_incidents':
        makePayload.pin = data.pin || '';
        makePayload.read_only = (data.read_only === true || data.read_only === 'true');
        break;
      default:
        makePayload = { ...makePayload, ...data };
    }

     const makeResp = await fetch(MAKE_WEBHOOK_RESPUESTA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makePayload),
    });

    const textRaw = await makeResp.text();
    const snippet = textRaw.slice(0, 500);
    const stripBOM = (s='') => s.replace(/^\uFEFF/, '').trim();
    const tryJSON = (s) => { try { return JSON.parse(s); } catch { return null; } };
    function unwrapIfQuotedJSON(s) {
      if (s.startsWith('"') && s.endsWith('"')) {
        const once = tryJSON(s);
        if (typeof once === 'string') return once.trim();
      }
      return s;
    }
    function extractFirstJSON(s) {
      s = stripBOM(s);
      let parsed = tryJSON(s);
      if (parsed) return parsed;
      s = unwrapIfQuotedJSON(s);
      parsed = tryJSON(s);
      if (parsed) return parsed;
      const startIdx = s.search(/[{[]/);
      if (startIdx >= 0) {
        const candidate = s.slice(startIdx);
        const lastCurly = candidate.lastIndexOf('}');
        const lastBracket = candidate.lastIndexOf(']');
        const endIdx = Math.max(lastCurly, lastBracket);
        if (endIdx > 0) {
          const slice = candidate.slice(0, endIdx + 1);
          const p2 = tryJSON(slice);
          if (p2) return p2;
        }
      }
      return null;
    }

    const parsed = extractFirstJSON(textRaw);

      if (
      data.action === 'get_assigned_incidents' &&
      makeResp.ok &&
      !parsed &&
      textRaw.trim().toLowerCase() === 'accepted'
    ) {
      console.info('[webhook-respuesta] Lista vacía por respuesta "Accepted"');
      return res.status(200).json({ status: 'success', incidents: [] });
    }
     
    if (!makeResp.ok || !parsed) {
      console.error('[Make webhook] status:', makeResp.status);
      console.error('[Make webhook] body snippet:', snippet);
       return res
        .status(makeResp.ok ? 502 : makeResp.status)
        .json({
          status: 'error',
          make_status: makeResp.status,
          body_snippet: snippet,
        });
    }
    if (data.action === 'get_assigned_incidents') {
    const demoEnabled =
        process.env.ALLOW_DEMO_INCIDENTS === '1' ||
        String(data.demo || '') === '1';

    const sortLogChronologically = (logStr = "") => {
        const lines = String(logStr)
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean)
          .sort((a, b) => {
            const ma = a.match(/^\[(.+?)\]/);
            const mb = b.match(/^\[(.+?)\]/);
            const da = ma ? new Date(ma[1]) : 0;
            const db = mb ? new Date(mb[1]) : 0;
            return da - db;
          });
        return lines.join("\n");
      };
       
      const normalizeLogs = (inc = {}) => {
        for (const key of Object.keys(inc)) {
          if (!/log/i.test(key)) continue;
          let val = inc[key];
           
          if (Array.isArray(val)) val = val.join("\n");
          if (val === undefined || val === null || val === "") {
            val = "{{emptystring}}";
          } else if (typeof val === "object") {
            try {
              val = JSON.stringify(val, null, 2);
            } catch (err) {
              val = String(val);
            }
          } else if (typeof val !== "string") {
            val = String(val);
          }
          inc[key] = val;
        }
         if (!("solicitudes_log" in inc) && inc["Solicitudes (log)"]) {
          inc.solicitudes_log = inc["Solicitudes (log)"];
        }
        if (!("respuestas_log" in inc) && inc["Respuestas (log)"]) {
          inc.respuestas_log = inc["Respuestas (log)"];
        }
        ["solicitudes_log", "respuestas_log"].forEach(k => {
          if (inc[k] === undefined || inc[k] === null || inc[k] === "") {
            inc[k] = "{{emptystring}}";
          } else {
            inc[k] = sortLogChronologically(inc[k]);
          }
        });
        return inc;
      };

      const normalizeIncident = (inc = {}) => {
        normalizeLogs(inc);
        const lvl = parseInt(inc.escalation_level, 10) || 0;

        // Limpiar campos de niveles superiores solo si no traen información útil,
        // pero conservando los del nivel inmediato superior (N+1)
        ['l1', 'l2', 'l3'].forEach((prefix, idx) => {
          const level = idx + 1;
          if (lvl + 1 < level) {
            Object.keys(inc).forEach(key => {
              if (!key.startsWith(prefix + '_')) return;
              const val = inc[key];
              const hasContent =
                val !== undefined &&
                val !== null &&
                !(typeof val === 'string' && val.trim() === '') &&
                val !== '{{emptystring}}';
              if (!hasContent) inc[key] = '{{emptystring}}';
            });
          }
        });

        // Datos de nivel actual
        inc.current_level = lvl;
        const slaKeys = [
          'sla_l0_end',
          'sla_l1_backup_end',
          'sla_l2_equipo_end',
          'sla_l3_responsable_end'
        ];
        const techKey = lvl === 2 ? 'l2_technicians' : `l${lvl}_technician`;
        const slaKey = slaKeys[lvl];
        const currentTech = inc[techKey];
        const currentSlaEnd = slaKey ? inc[slaKey] : null;
        if (currentTech !== undefined) inc.current_technician = currentTech;

        if (currentSlaEnd && Date.parse(currentSlaEnd) && Date.now() > Date.parse(currentSlaEnd)) {
          // SLA vencido para el nivel actual
          inc.status = 'seguimiento';
          inc.current_technician = { email: currentTech, sla_end: currentSlaEnd };
          const upperLvl = lvl + 1;
          if (upperLvl <= 3) {
            const upperTechKey = upperLvl === 2 ? 'l2_technicians' : `l${upperLvl}_technician`;
            const upperSlaKey = slaKeys[upperLvl];
            inc.upper_level = {
              level: upperLvl,
              technician: inc[upperTechKey],
              sla_end: upperSlaKey ? inc[upperSlaKey] : null
            };
          }
        }
         
        return inc;
      };

      if (demoEnabled) {
          const inMinutes = (m) => `{{addMinutes(now; ${m})}}`;

          // Genera todas las combinaciones de estado y nivel 0-3
          const statuses = ["Trabajando", "Pendiente", "En seguimiento"];
          const baseOffsets = { Trabajando: -30, Pendiente: 45, "En seguimiento": -90 };
          const demoIncidents = [];

          statuses.forEach(st => {
            for (let level = 0; level <= 3; level++) {
              const base = baseOffsets[st] + level * 5;
              const sLogs = [
                '2024-05-10T09:00:00Z Solicitud de reinicio'
              ];
              const rLogs = [
                '2024-05-10T09:30:00Z L0 reporta éxito'
              ];
              demoIncidents.push({
                id: `INC-${st.replace(/\s+/g, "").toUpperCase()}-L${level}`,
                status: st,
                priority: "MEDIA",
                equipment: `Equipo ${level}`,
                zone: `Zona ${level}`,
                description: `Ejemplo ${st} nivel ${level}`,
                report_date: inMinutes(base),
                escalation_level: level,
                l1_technician: "tecnico@empresa.com",
                l1_response: "✅ Acepto",
                sla_l1_backup_end: inMinutes(base + 60),
                materials: `Pieza-${level} (${level + 1}); Herramienta-${level} (${level + 2})`,
                notes: `Nota ejemplo L${level}`,
                solicitudes_log: sLogs.join("\n") || "{{emptystring}}",
                respuestas_log: rLogs.join("\n") || "{{emptystring}}",
                materials_url: `https://example.com/materials/${st.replace(/\s+/g, '-').toLowerCase()}-l${level}`,
                history_url: `https://example.com/history/${st.replace(/\s+/g, '-').toLowerCase()}-l${level}`
              });
            }
          });

          return res
            .status(200)
            .json({ status: "success", incidents: demoIncidents.map(normalizeLogs) });
        }
      
      if (Array.isArray(parsed.incidents)) return res.status(200).json({ status: 'success', incidents: parsed.incidents.map(normalizeIncident) });
      if (parsed.data && Array.isArray(parsed.data.incidents)) return res.status(200).json({ status: 'success', incidents: parsed.data.incidents.map(normalizeIncident) });
      if (Array.isArray(parsed) && parsed.every(x => x && typeof x === 'object')) return res.status(200).json({ status: 'success', incidents: parsed.map(normalizeIncident) });
      return res.status(502).json({ status: 'error', message: 'Respuesta de Make es JSON pero no contiene incidents[]' });
    }
    
    if (parsed) {
      return res.status(200).json(parsed);
    }

    const okText = stripBOM(textRaw);
    if (/^(ok|accepted)$/i.test(okText)) {
      return res.status(200).json({
        status: 'success',
        message: 'Operación aceptada por Make',
        action: data.action,
        incident_id: data.incident_id,
        timestamp: new Date().toISOString(),
      });
    }

    return res.status(200).json({
      status: 'success',
      message: `Acción ${data.action} procesada (sin JSON)`,
      action: data.action,
      incident_id: data.incident_id,
      raw: okText.slice(0, 500),
    });

  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: 'Error interno del servidor',
      error: process.env.NODE_ENV === 'development' ? String(err?.stack || err) : String(err?.message || err),
      action: (req.body && req.body.action) || 'unknown',
      timestamp: new Date().toISOString()
    });
  }
};
