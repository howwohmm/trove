import { SwipeDeck } from "@/components/SwipeDeck";
import { Footer } from "@/components/Footer";

// the deck floats in the void — bg0 ground, faint key hints in the lower
// corners, footer-index quiet below (contract: it's on every page).
export function Page() {
  return (
    <main className="page page--void">
      <div
        className="page-body"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <SwipeDeck />
        <span
          className="t-hint"
          aria-hidden
          style={{ position: "absolute", left: "0.2rem", bottom: "0.5rem" }}
        >
          ← let go
        </span>
        <span
          className="t-hint"
          aria-hidden
          style={{ position: "absolute", right: "0.2rem", bottom: "0.5rem" }}
        >
          keep →
        </span>
      </div>
      <Footer />
    </main>
  );
}

export default Page;
