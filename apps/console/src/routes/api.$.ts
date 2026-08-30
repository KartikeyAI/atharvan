import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      ANY: ({ request }) => proxyControlPlaneRequest(request),
    },
  },
});

function proxyControlPlaneRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/api/platform/")) {
    url.pathname = url.pathname.replace("/api/platform/", "/v1/platform/");
  } else if (!url.pathname.startsWith("/api/auth/")) {
    return Promise.resolve(
      Response.json(
        { code: "not_found", message: "The console API route does not exist." },
        { status: 404 },
      ),
    );
  }

  if (env.CONTROL_PLANE === undefined) {
    return Promise.resolve(
      Response.json(
        {
          code: "control_plane_unavailable",
          message: "The console control-plane binding is unavailable.",
        },
        { status: 503 },
      ),
    );
  }

  return env.CONTROL_PLANE.fetch(new Request(url, request));
}
