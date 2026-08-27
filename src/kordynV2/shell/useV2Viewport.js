import { useEffect, useState } from "react";

export const KORDYN_V2_MOBILE_QUERY = "(max-width: 767px)";

function matchesMobileViewport() {
  return typeof window !== "undefined" && window.matchMedia(KORDYN_V2_MOBILE_QUERY).matches;
}

export function useV2Viewport() {
  const [mobile, setMobile] = useState(matchesMobileViewport);

  useEffect(() => {
    const query = window.matchMedia(KORDYN_V2_MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return mobile ? "mobile" : "desktop";
}
