// /api/webhook-respuesta.js

const MAKE_WEBHOOK_RESPUESTA = process.env.MAKE_WEBHOOK_RESPUESTA || '';
const MAKE_WEBHOOK_REGEX = /^https:\/\/hook\.eu\d+\.make\.com\/.+/;
const MAKE_WEBHOOK_VALID = MAKE_WEBHOOK_REGEX.test(MAKE_WEBHOOK_RESPUESTA);
if (!MAKE_WEBHOOK_VALID) {
  console.error('[webhook-respuesta] URL de webhook inválida:', MAKE_WEBHOOK_RESPUESTA);
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
    return res.status(500).json({ status: 'error', message: 'Webhook no configurado correctamente en el servidor' });
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
        makePayload.reason = data.reason;
        makePayload.escalation_level = Number.isFinite(+data.escalation_level) ? +data.escalation_level : 0;
        break;
      case 'resolver':
        if (!data.solution_description || !data.time_invested) {
          return res.status(400).json({ status: 'error', message: 'solution_description y time_invested son obligatorios' });
        }
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
        makePayload.current_department = data.current_department || '';
        makePayload.target_department = data.target_department;
        makePayload.derivation_reason = data.derivation_reason;
        makePayload.technical_notes = data.technical_notes || '';
        break;
      case 'ayuda':
        if (!data.help_type || !data.help_description) {
          return res.status(400).json({ status: 'error', message: 'help_type y help_description son obligatorios' });
        }
        makePayload.help_type = data.help_type;
        makePayload.help_description = data.help_description;
        makePayload.urgency = data.urgency || 'media';
        break;
      case 'solicitar_asignacion':
        makePayload.request_reason = data.request_reason || '';
        makePayload.request_justification = data.request_justification || '';
        break;
      case 'aportar_informacion':
        makePayload.information_type = data.information_type || '';
        makePayload.information_content = data.information_content || '';
        makePayload.attachments = Array.isArray(data.attachments) ? data.attachments : [];
        break;
      case 'validate_pin':
        makePayload.pin = data.pin || '';
        break;
      case 'get_assigned_incidents':
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
    if (!makeResp.ok || !parsed) {
     console.error('[Make webhook] status:', makeResp.status);
      console.error('[Make webhook] body snippet:', snippet);
    }
    if (data.action === 'get_assigned_incidents') {
    const demoEnabled =
        process.env.ALLOW_DEMO_INCIDENTS === '1' ||
        String(data.demo || '') === '1';

      if (demoEnabled) {
        const demoIncidents = [
          {
            id: 'INC-DEMO-1',
            priority: 'ALTA',
            equipment: 'Generador principal',
            zone: 'Zona A',
            description: 'Falla en el generador (demo).',
            report_date: '2024-01-10T10:00:00Z',
          },
          {
            id: 'INC-DEMO-2',
            priority: 'MEDIA',
            equipment: 'Sensor de temperatura',
            zone: 'Zona B',
            description: 'Lecturas fuera de rango (demo).',
            report_date: '2024-01-11T15:30:00Z',
          },
        ];
        return res.status(200).json({ status: 'success', incidents: demoIncidents });
      }

      if (!makeResp.ok || !parsed) {
        return res.status(502).json({
          status: 'error',
          message: 'Servicio de incidencias no disponible'
        });
      }
      
      if (Array.isArray(parsed.incidents)) return res.status(200).json({ status: 'success', incidents: parsed.incidents });
      if (parsed.data && Array.isArray(parsed.data.incidents)) return res.status(200).json({ status: 'success', incidents: parsed.data.incidents });
      if (Array.isArray(parsed) && parsed.every(x => x && typeof x === 'object')) return res.status(200).json({ status: 'success', incidents: parsed });
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
      action: (req.body && req.body.action) || (req.query && req.query.action) || 'unknown',
      timestamp: new Date().toISOString()
    });
  }
};
