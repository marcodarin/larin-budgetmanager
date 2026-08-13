import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from '../_shared/mandrill.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendToClientRequest {
  offer_id: string;
  to?: string;
  message?: string;
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error("Missing authorization header");
      return new Response(
        JSON.stringify({ error: 'Missing authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Service role per le letture: non ci si fida di quello che manda il
    // browser (nome cliente, importo, riferimento), si rilegge tutto dal
    // database, come in send-budget-notification.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error("Authentication failed:", authError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Richiede utente approvato (blocca account nuovi/non approvati), stesso
    // controllo di send-budget-notification.
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('approved, deleted_at, first_name, last_name')
      .eq('id', user.id)
      .maybeSingle();
    if (!callerProfile?.approved || callerProfile.deleted_at) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { offer_id, to, message }: SendToClientRequest = await req.json();
    if (!offer_id) {
      return new Response(
        JSON.stringify({ error: 'offer_id mancante' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log("Sending offer to client, offer:", offer_id, "by user:", user.id);

    const { data: offer, error: offerError } = await supabase
      .from('offers')
      .select('id, year, number, client_id, current_version_id')
      .eq('id', offer_id)
      .maybeSingle();
    if (offerError || !offer) {
      return new Response(
        JSON.stringify({ error: 'Offerta non trovata' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!offer.current_version_id) {
      return new Response(
        JSON.stringify({ error: "L'offerta non ha ancora una versione corrente da inviare" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: version, error: versionError } = await supabase
      .from('offer_versions')
      .select('offered_total, valid_until')
      .eq('id', offer.current_version_id)
      .maybeSingle();
    if (versionError || !version) {
      throw new Error('Versione corrente dell\'offerta non trovata');
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('name, email')
      .eq('id', offer.client_id)
      .maybeSingle();
    if (clientError || !client) {
      throw new Error('Cliente non trovato');
    }

    const recipient = (to && to.trim()) || client.email || null;
    if (!recipient) {
      return new Response(
        JSON.stringify({ error: 'Il cliente non ha un indirizzo email in anagrafica: specifica un destinatario.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Link attivo dell'offerta: se manca, lo si crea con il JWT di chi sta
    // inviando (non con il service role) perché create_offer_public_link si
    // appoggia ad auth.uid() sia per l'autorizzazione (can_manage_offer) sia
    // per valorizzare created_by.
    let publicLinkId: string;
    let publicLinkToken: string;
    const { data: existingLink } = await supabase
      .from('offer_public_links')
      .select('id, token')
      .eq('offer_id', offer_id)
      .is('revoked_at', null)
      .maybeSingle();

    if (existingLink) {
      publicLinkId = existingLink.id;
      publicLinkToken = existingLink.token;
    } else {
      const supabaseAsUser = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: newLink, error: createLinkError } = await supabaseAsUser.rpc('create_offer_public_link', {
        _offer_id: offer_id,
      });
      if (createLinkError || !newLink) {
        return new Response(
          JSON.stringify({ error: createLinkError?.message || 'Impossibile generare il link pubblico' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      publicLinkId = newLink.id;
      publicLinkToken = newLink.token;
    }

    // Dominio pubblico dell'app e mittente: da variabili d'ambiente, con un
    // valore di ripiego sensato se non ancora configurate (vedi rapporto).
    const siteUrl = Deno.env.get('SITE_URL') || 'https://timetrap.it';
    const fromEmail = Deno.env.get('OFFER_SENDER_EMAIL') || 'noreply@timetrap.it';
    const fromName = Deno.env.get('OFFER_SENDER_NAME') || 'Larin';

    const linkUrl = `${siteUrl}/offerta/${publicLinkToken}`;
    const reference = `${offer.year}/${offer.number}`;
    const senderName = [callerProfile.first_name, callerProfile.last_name].filter(Boolean).join(' ').trim();

    const subject = `Offerta ${reference} da Larin`;

    const messageParagraph = message?.trim()
      ? `<p style="font-size: 15px; white-space: pre-line;">${escapeHtml(message.trim())}</p>`
      : '';

    const validityLine = version.valid_until
      ? `<p style="margin: 6px 0; font-size: 15px;"><strong>Valida fino al:</strong> ${new Date(version.valid_until).toLocaleDateString('it-IT')}</p>`
      : '';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
      </head>
      <body style="font-family: Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a3330; margin: 0; padding: 20px; background-color: #f2f8f6;">
        <div style="max-width: 600px; margin: 0 auto; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 25px -8px rgba(61,190,170,0.25);">
          <div style="background: linear-gradient(135deg, #3dbeaa, #fac320); padding: 30px 40px; text-align: center;">
            <h1 style="color: #ffffff; font-size: 28px; font-weight: 700; margin: 0;">Larin</h1>
          </div>
          <div style="background-color: #ffffff; padding: 32px 40px;">
            <h2 style="color: #1a3330; font-size: 22px; font-weight: 700; margin: 0 0 16px;">La sua offerta è pronta</h2>
            <p style="font-size: 15px;">Gentile ${escapeHtml(client.name)},</p>
            <p style="font-size: 15px;">Le inviamo l'offerta <strong>${reference}</strong>, a disposizione per essere consultata e, se concorda, accettata online.</p>
            ${messageParagraph}
            <div style="background-color: #f2f8f6; padding: 20px; border-radius: 12px; margin: 20px 0; border: 1px solid #cce5df;">
              <p style="margin: 6px 0; font-size: 15px;"><strong>Offerta:</strong> ${reference}</p>
              <p style="margin: 6px 0; font-size: 15px;"><strong>Importo:</strong> ${Number(version.offered_total).toFixed(2)} €</p>
              ${validityLine}
            </div>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${linkUrl}" style="display: inline-block; background-color: #3dbeaa; color: #ffffff; text-decoration: none; font-weight: 600; padding: 14px 28px; border-radius: 999px; font-size: 15px;">Apri l'offerta</a>
            </div>
            <p style="font-size: 13px; color: #527a73;">Se il pulsante non funziona, copi e incolli questo indirizzo nel browser:<br>${linkUrl}</p>
            <p style="font-size: 15px; margin-top: 24px;">Cordiali saluti,<br>${senderName ? `${escapeHtml(senderName)} - Larin` : 'Il team Larin'}</p>
          </div>
          <div style="background-color: #f2f8f6; padding: 20px 40px; text-align: center; border-top: 1px solid #cce5df;">
            <p style="color: #527a73; font-size: 12px; margin: 0;">Larin</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailResponse = await sendEmail({
      from_email: fromEmail,
      from_name: fromName,
      to: [recipient],
      subject,
      html: htmlContent,
    });

    console.log("Offer email sent successfully:", emailResponse);

    // "Gliel'ho mandata o no?" deve avere risposta anche mezz'ora dopo: si
    // registra l'invio (contatore + destinatario + istante) sul link. Non
    // blocca la risposta di successo: l'email è già partita, un fallimento
    // qui sarebbe solo un dato di tracciamento mancante, non un invio fallito.
    const { error: recordSentError } = await supabase.rpc('record_offer_link_sent', {
      _public_link_id: publicLinkId,
      _sent_to: recipient,
    });
    if (recordSentError) {
      console.error("Error recording offer link sent:", recordSentError);
    }

    return new Response(
      JSON.stringify({ ok: true, sent_to: recipient, link_url: linkUrl }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in offer-send-to-client function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
