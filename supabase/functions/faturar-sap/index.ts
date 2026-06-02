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

    const response = await fetch('https://tableros.ngrok.app/Invoices', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      // Retornar 200 com a string de error no body, pois o supabase-js 
      // mascara erros 400 como "Edge Function returned a non-2xx status code"
      return new Response(
        JSON.stringify({ error: `A API do SAP (ngrok) retornou um erro: ${errorText} (Status: ${response.status})` }),
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
      JSON.stringify({ error: `Falha de rede da nuvem para o Ngrok: ${error.message}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  }
})
