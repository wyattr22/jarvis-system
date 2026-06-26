#!/usr/bin/env python3
"""
Download free peer-reviewed trading/finance research papers from arXiv.
Saves PDFs into ./jarvis_papers/ organized by topic.

Uses the arXiv listing pages (not the rate-limited search API) to discover papers,
then downloads PDFs directly by ID.

Usage:
    pip install requests
    python download_papers.py

Then ingest into Jarvis:
    python ingest_papers.py --dir ./jarvis_papers --secret YOUR_CRON_SECRET
"""

import os
import re
import sys
import time
import requests

PAPERS_TARGET = 350       # total NEW papers to download this run
DELAY_HTML = 2.5          # seconds between listing page fetches
DELAY_PDF = 3.0           # seconds between PDF downloads
DELAY_META = 1.0          # seconds between metadata (title) fetches

HEADERS = {
    "User-Agent": "JarvisResearchBot/1.0 (wrantz@calpoly.edu)"
}

# Full topic coverage — arXiv categories mapped to folder labels
# Covers: trading rules/regulations, order flow, microstructure, HFT algorithms,
# financial network analysis, ML/DL, portfolio analysis, quantum computing,
# NLP for finance, econophysics, causal inference, game theory, DeFi/blockchain,
# behavioral finance, ESG, FinTech, time series, computer vision for finance
CATEGORIES = [
    # Quantitative finance — all sub-categories
    ("q-fin.TR", "market_microstructure_orderflow"),    # trading, order flow, microstructure, HFT
    ("q-fin.PM", "portfolio_optimization"),             # portfolio analysis, asset allocation
    ("q-fin.RM", "risk_management_hedging"),            # risk management, hedging, regulation
    ("q-fin.ST", "statistical_finance"),                # statistical models, time series, factor models
    ("q-fin.CP", "computational_finance"),              # numerical methods, algorithms
    ("q-fin.MF", "mathematical_finance"),               # stochastic calculus, derivatives pricing
    ("q-fin.GN", "trading_rules_regulations"),          # general finance, trading laws, compliance
    ("q-fin.EC", "financial_economics"),                # financial economics, market design
    # Machine learning & AI for finance
    ("cs.LG",    "ml_deep_learning_finance"),           # ML, deep learning, predictive modeling
    ("cs.CL",    "nlp_for_finance"),                    # NLP, text mining, sentiment, LLM finance
    ("cs.CV",    "computer_vision_finance"),            # chart recognition, alternative data imaging
    ("cs.AI",    "ai_agents_finance"),                  # AI agents, planning, autonomous trading
    ("cs.MA",    "multi_agent_financial_systems"),      # multi-agent systems, ABMs, agent-based markets
    ("stat.ML",  "statistical_learning"),               # Bayesian methods, time series ML
    # Time series & econometrics
    ("econ.EM",  "causal_inference_econometrics"),      # causal inference, IV, diff-in-diff, panel data
    ("econ.GN",  "behavioral_finance_regulation"),      # behavioral finance, ESG, financial inclusion
    ("econ.TH",  "game_theory_market_design"),          # game theory, mechanism design, auctions
    # Network & complexity
    ("cs.SI",    "financial_network_analysis"),         # network analysis, systemic risk, contagion
    ("physics.soc-ph", "econophysics"),                 # econophysics, complex systems, scaling laws
    # Quantum & cryptography
    ("quant-ph", "quantum_computing_finance"),          # quantum ML, quantum optimization, QAOA
    ("cs.CR",    "blockchain_defi_fintech"),            # blockchain, DeFi, smart contracts, crypto
    ("cs.GT",    "game_theory_mechanism_design"),       # algorithmic game theory, market mechanisms
]

MONTHS = ["2025-02", "2025-01", "2024-12", "2024-11", "2024-10", "2024-09", "2024-08"]


def get_paper_ids_from_listing(category: str, month: str) -> list[str]:
    url = f"https://arxiv.org/list/{category}/{month}"
    try:
        r = requests.get(url, timeout=20, verify=False, headers=HEADERS)
        if r.status_code != 200:
            print(f"    listing HTTP {r.status_code} for {category}/{month}")
            return []
        ids = re.findall(r"/abs/([\d]+\.[\d]+)", r.text)
        return list(dict.fromkeys(ids))  # dedupe preserving order
    except Exception as e:
        print(f"    listing error {category}/{month}: {e}")
        return []


def get_paper_title(paper_id: str) -> str:
    url = f"https://arxiv.org/abs/{paper_id}"
    try:
        r = requests.get(url, timeout=15, verify=False, headers=HEADERS)
        if r.status_code != 200:
            return paper_id
        m = re.search(r'<h1 class="title[^"]*"[^>]*><span[^>]*>[^<]*</span>([^<]+)', r.text)
        if m:
            return m.group(1).strip()
        m = re.search(r'<title>\s*\[[\d.]+\]\s*([^<|]+)', r.text)
        if m:
            return m.group(1).strip()
        return paper_id
    except Exception:
        return paper_id


def download_pdf(paper_id: str, dest: str) -> bool:
    url = f"https://arxiv.org/pdf/{paper_id}"
    try:
        r = requests.get(url, headers=HEADERS, timeout=45, stream=True, verify=False)
        if r.status_code == 200:
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)
            return os.path.getsize(dest) > 10_000  # reject tiny/empty files
        else:
            print(f"    PDF HTTP {r.status_code}")
            return False
    except Exception as e:
        print(f"    PDF error: {e}")
        return False


def collect_ids(target: int) -> list[tuple[str, str]]:
    """Returns list of (paper_id, topic_label) up to target count."""
    seen = set()
    result = []

    for cat, label in CATEGORIES:
        if len(result) >= target:
            break
        for month in MONTHS:
            if len(result) >= target:
                break
            ids = get_paper_ids_from_listing(cat, month)
            new_ids = [i for i in ids if i not in seen]
            for pid in new_ids:
                if len(result) >= target:
                    break
                seen.add(pid)
                result.append((pid, label))
            print(f"  {cat}/{month}: +{len(new_ids)} new  (total {len(result)})")
            time.sleep(DELAY_HTML)

    return result


def main():
    base_dir = "./jarvis_papers"
    os.makedirs(base_dir, exist_ok=True)

    # Check existing papers so re-run is fast
    existing_ids = set()
    for root, _, files in os.walk(base_dir):
        for f in files:
            if f.lower().endswith(".pdf"):
                m = re.match(r"^([\d]+\.[\d]+)_", f)
                if m:
                    existing_ids.add(m.group(1))

    print(f"\nJarvis Research Downloader (listing-page mode)")
    print(f"Target: {PAPERS_TARGET} papers  |  Already downloaded: {len(existing_ids)}")
    print(f"Output: {os.path.abspath(base_dir)}\n")

    print("Phase 1 — collecting paper IDs from arXiv listing pages...")
    candidates = collect_ids(PAPERS_TARGET + len(existing_ids) + 50)
    print(f"\nCollected {len(candidates)} candidate IDs\n")

    print("Phase 2 — downloading PDFs...\n")
    downloaded = 0
    skipped = 0

    for i, (paper_id, label) in enumerate(candidates, 1):
        if downloaded >= PAPERS_TARGET:
            break

        if paper_id in existing_ids:
            skipped += 1
            continue

        # Get title (1 req per paper — keep delay low)
        print(f"  [{downloaded+1}/{PAPERS_TARGET}] {paper_id}  ", end="", flush=True)
        title = get_paper_title(paper_id)
        time.sleep(DELAY_META)

        safe_title = re.sub(r'[^\w\s\-()]', '_', title)[:70].strip()
        filename = f"{paper_id}_{safe_title}.pdf"
        out_dir = os.path.join(base_dir, label)
        os.makedirs(out_dir, exist_ok=True)
        dest = os.path.join(out_dir, filename)

        if os.path.exists(dest):
            existing_ids.add(paper_id)
            skipped += 1
            print(f"(exists)")
            continue

        print(f"{title[:55]}")
        if download_pdf(paper_id, dest):
            downloaded += 1
            existing_ids.add(paper_id)
            print(f"      ✓ {os.path.getsize(dest)//1024} KB  → {label}/{filename[:50]}")
        else:
            if os.path.exists(dest):
                os.remove(dest)
            print(f"      ✗ failed")

        time.sleep(DELAY_PDF)

    print(f"\n✓ Done — {downloaded} new papers downloaded  ({skipped} skipped/existing)")
    print(f"\nNext — ingest into Jarvis:")
    print(f"  python ingest_papers.py --dir {base_dir} --secret YOUR_CRON_SECRET\n")


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")  # suppress InsecureRequestWarning for verify=False
    main()
