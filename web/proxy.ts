import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher([
  "/crypto",
  "/crypto/profile(.*)",
  "/api/watchlist(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/crypto/:path*", "/crypto", "/api/watchlist/:path*"],
};
