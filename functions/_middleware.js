const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequest = async (context) => {
  if (context.request.method === "OPTIONS") {
    return onRequestOptions();
  }
  const response = await context.next();
  const next = new Response(response.body, response);
  for (const [key, value] of Object.entries(corsHeaders)) {
    next.headers.set(key, value);
  }
  return next;
};

export { corsHeaders };
