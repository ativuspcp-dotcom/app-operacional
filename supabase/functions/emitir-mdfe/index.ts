import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const payload = await req.json()
    
    // O Token da Brasil NFe fornecido pelo usuario
    const token = 'bGtDRU5TMVdBamMzV1JwcGdIZ2dFcmRnem5OanZrK3ZFaUpLTVY1eDdsMD06K1ZPUllpSVVBMEtaR3ZWam9xczNmUT09OjI1LzA1LzIwMzY=';

    const response = await fetch('https://api.brasilnfe.com.br/services/fiscal/EnviarManifestoTransporte', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Token': token
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(
        JSON.stringify({ error: `A API Brasil NFe retornou um erro: ${errorText} (Status: ${response.status})` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const responseData = await response.json()

    return new Response(
      JSON.stringify({ success: true, data: responseData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: `Falha de rede da nuvem para a Brasil NFe: ${error.message}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
