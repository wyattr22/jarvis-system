#!/usr/bin/env python3
"""
Bulk-ingest PDF research papers into Jarvis's RAG knowledge base.

Usage:
    pip install pymupdf requests
    python ingest_papers.py --dir ./jarvis_papers --url https://jarvis-system-flame.vercel.app --secret YOUR_CRON_SECRET

Or for a single file:
    python ingest_papers.py --file paper.pdf --url https://jarvis-system-flame.vercel.app --secret YOUR_CRON_SECRET
"""

import argparse
import os
import sys
import time
import requests

def sanitize(text: str) -> str:
    # Strip control chars (keep tab/LF/CR) and supplementary-plane Unicode
    # (U+10000+). Supplementary chars encode as JSON surrogate pairs which
    # Turso's HTTP API rejects with a 400.
    return "".join(
        c for c in text
        if (ord(c) >= 0x20 or c in "\t\n\r") and ord(c) <= 0xFFFF
    )

def extract_text(path: str) -> str:
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(path)
        pages = []
        for page in doc:
            pages.append(page.get_text())
        raw = "\n\n".join(pages)
        return sanitize(raw)
    except ImportError:
        print("  ⚠  PyMuPDF not installed. Run: pip install pymupdf")
        sys.exit(1)
    except Exception as e:
        print(f"  ⚠  Failed to extract text: {e}")
        return ""

def ingest(url: str, secret: str, source_name: str, content: str) -> bool:
    endpoint = f"{url.rstrip('/')}/api/research/ingest"
    headers  = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json"}
    payload  = {"sourceName": source_name, "content": content}
    try:
        r = requests.post(endpoint, json=payload, headers=headers, timeout=60)
        if r.ok:
            data = r.json()
            print(f"  ✓  {data.get('chunks', '?')} chunks stored")
            return True
        else:
            print(f"  ✗  HTTP {r.status_code}: {r.text[:200]}")
            return False
    except Exception as e:
        print(f"  ✗  Request failed: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Ingest PDFs into Jarvis research store")
    parser.add_argument("--dir",    help="Directory of PDFs to ingest")
    parser.add_argument("--file",   help="Single PDF to ingest")
    parser.add_argument("--url",    default="https://jarvis-system-flame.vercel.app", help="Jarvis base URL")
    parser.add_argument("--secret", default=os.environ.get("CRON_SECRET", ""), help="CRON_SECRET value")
    args = parser.parse_args()

    if not args.dir and not args.file:
        parser.print_help()
        sys.exit(1)

    pdfs = []
    if args.file:
        pdfs = [args.file]
    elif args.dir:
        for root, _, files in os.walk(args.dir):
            for f in files:
                if f.lower().endswith(".pdf"):
                    pdfs.append(os.path.join(root, f))

    print(f"\nJarvis Research Ingest — {len(pdfs)} PDF(s) → {args.url}\n")

    ok = 0
    for i, path in enumerate(pdfs, 1):
        source_name = os.path.splitext(os.path.basename(path))[0]
        print(f"[{i}/{len(pdfs)}] {source_name}")

        text = extract_text(path)
        if not text.strip():
            print("  ⚠  No text extracted — skipping (may be image-only PDF)")
            continue

        print(f"  → {len(text):,} chars extracted")
        if ingest(args.url, args.secret, source_name, text):
            ok += 1

        # Rate-limit: 3s between papers to avoid hammering Turso during active use
        if i < len(pdfs):
            time.sleep(3)

    print(f"\nDone — {ok}/{len(pdfs)} papers ingested successfully.")
    if ok < len(pdfs):
        print("Re-run the script for any failures — ingestion is idempotent.")

if __name__ == "__main__":
    main()
