"""Name normalisation and fuzzy matching (Title Case, roster spelling when it is clearly the same person)."""
import re
from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler

SMALL = {"de", "la", "del", "van", "von", "da", "di", "le", "du"}

def title_case(name):
    out = []
    for i, w in enumerate(re.split(r"\s+", name.strip())):
        if not w:
            continue
        lw = w.lower()
        if i > 0 and lw in SMALL:
            out.append(lw); continue
        # O'Neill, McDonald-ish, keep single letters / initials upper
        parts = re.split(r"([-'’])", lw)
        w2 = "".join(p.capitalize() if p not in "-'’" else p for p in parts)
        if re.fullmatch(r"mc[a-z]{2,}", lw):
            w2 = "Mc" + lw[2:].capitalize()
        out.append(w2)
    return " ".join(out)[:60]

def norm(name):
    return re.sub(r"[^a-z0-9 ]", "", re.sub(r"[-'’.]", "", name.lower())).strip()

def similarity(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    s1 = fuzz.token_sort_ratio(a, b) / 100
    s2 = JaroWinkler.similarity(a.replace(" ", ""), b.replace(" ", ""))
    # last names matter most: "Jack Argest" ~ "Shack Argust"
    la, lb = a.split()[-1], b.split()[-1]
    s3 = 0.5 * JaroWinkler.similarity(la, lb) + 0.5 * JaroWinkler.similarity(a.split()[0], b.split()[0]) if len(a.split()) > 1 and len(b.split()) > 1 else 0
    return max(s1, s2 * 0.97, s3)

def best_match(name, candidates, threshold=0.84):
    """candidates: iterable of (key, display_name). Returns (key, display, score) or None."""
    best = None
    for key, disp in candidates:
        s = similarity(name, disp)
        if best is None or s > best[2]:
            best = (key, disp, s)
    return best if best and best[2] >= threshold else None
