#!/usr/bin/env python3
"""
rp.py — Research pipeline CLI (Scopus main + OpenAlex enrichment).

Subcommands
-----------
  search   "<query>" [--limit N] [--min-year Y] [--json out.json]
           Scopus relevance search -> enrich with OpenAlex abstracts/OA links.
           Emits candidate records with everything needed for LLM relevance scoring.

  abstracts <doi> [<doi> ...] | --file dois.txt
           Batch-fetch abstracts + OA links for a DOI list via OpenAlex.

  cite     <doi> [--direction both|backward|forward] [--limit N] [--json out.json]
           Citation traversal via OpenAlex. backward = referenced_works,
           forward = papers citing it. Deduped, with abstracts.

  fulltext <doi> [--out file.xml]
           Fetch OA full text (Elsevier ScienceDirect for Elsevier OA; OpenAlex
           pdf link otherwise). Paywalled -> reported unavailable.

All output is JSON on stdout (records) + a human summary on stderr.
The LLM (the skill) does the relevance *judgement*; this tool does the *plumbing*.
"""

import argparse
import json
import sys

import rp_lib as L


def _emit(records, out_path=None):
    payload = json.dumps(records, ensure_ascii=False, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(payload)
        print(f"[rp] wrote {len(records) if isinstance(records, list) else 1} record(s) -> {out_path}",
              file=sys.stderr)
    else:
        print(payload)


def cmd_search(a):
    hits = L.scopus_search(a.query, limit=a.limit)
    if a.min_year:
        hits = [h for h in hits if (h["year"] or "0").isdigit() and int(h["year"]) >= a.min_year]
    dois = [h["doi"] for h in hits if h["doi"]]
    enriched = L.openalex_by_dois(dois)
    n_abs = 0
    for h in hits:
        oa = enriched.get(h["doi"]) if h["doi"] else None
        if oa:
            h["abstract"] = oa["abstract"]
            h["openalex_id"] = oa["openalex_id"]
            h["oa_status"] = oa["oa_status"]
            h["oa_pdf_url"] = oa["oa_pdf_url"]
            if oa["abstract"]:
                n_abs += 1
        else:
            h["abstract"] = ""
            h["openalex_id"] = None
    print(f"[rp] search '{a.query}': {len(hits)} hits, {n_abs} with abstracts "
          f"({len(dois)} DOIs enriched via OpenAlex)", file=sys.stderr)
    _emit(hits, a.json)


def cmd_abstracts(a):
    dois = a.dois
    if a.file:
        dois += [l.strip() for l in open(a.file) if l.strip()]
    recs = L.openalex_by_dois(dois)
    out = [recs.get(d.lower(), {"doi": d.lower(), "abstract": "", "_missing": True}) for d in dois]
    got = sum(1 for r in out if r.get("abstract"))
    print(f"[rp] abstracts: {got}/{len(dois)} found in OpenAlex", file=sys.stderr)
    _emit(out, a.json)


def cmd_cite(a):
    seed = L.openalex_get(a.doi)
    if not seed:
        print(f"[rp] seed DOI {a.doi} not found in OpenAlex", file=sys.stderr)
        _emit({"backward": [], "forward": []}, a.json)
        return
    result = {"seed": {"doi": seed["doi"], "title": seed["title"],
                       "openalex_id": seed["openalex_id"]},
              "backward": [], "forward": []}
    if a.direction in ("both", "backward"):
        refs = seed["referenced_works"][: a.limit]
        result["backward"] = L.openalex_works_by_ids(refs)
    if a.direction in ("both", "forward"):
        result["forward"] = L.openalex_forward_citations(seed["openalex_id"], limit=a.limit)
    print(f"[rp] cite {a.doi}: {len(result['backward'])} backward, "
          f"{len(result['forward'])} forward", file=sys.stderr)
    _emit(result, a.json)


def cmd_fulltext(a):
    res = L.elsevier_fulltext(a.doi)
    if not res["available"]:
        # fall back to OpenAlex OA: prefer a direct PDF, else the OA landing page
        w = L.openalex_get(a.doi)
        if w and w.get("oa_pdf_url"):
            res = {"available": True, "source": "openalex-oa", "chars": 0,
                   "text": None, "pdf_url": w["oa_pdf_url"]}
        elif w and w.get("oa_landing") and (w.get("oa_status") or "closed") != "closed":
            # gold/green/hybrid OA with a landing page but no direct PDF in OpenAlex
            res = {"available": True, "source": "openalex-oa-landing", "chars": 0,
                   "text": None, "oa_status": w["oa_status"],
                   "landing_url": w["oa_landing"]}
    if a.out and res.get("text"):
        open(a.out, "w", encoding="utf-8").write(res["text"])
        print(f"[rp] full text -> {a.out} ({res['chars']} chars, {res['source']})", file=sys.stderr)
        res = {k: v for k, v in res.items() if k != "text"}
        res["saved_to"] = a.out
    print(f"[rp] fulltext {a.doi}: available={res['available']} source={res.get('source')}",
          file=sys.stderr)
    _emit({k: v for k, v in res.items() if k != "text"} if res.get("text") else res)


def main():
    p = argparse.ArgumentParser(prog="rp", description="Scopus+OpenAlex research pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search"); s.add_argument("query")
    s.add_argument("--limit", type=int, default=50); s.add_argument("--min-year", type=int)
    s.add_argument("--json"); s.set_defaults(fn=cmd_search)

    s = sub.add_parser("abstracts"); s.add_argument("dois", nargs="*")
    s.add_argument("--file"); s.add_argument("--json"); s.set_defaults(fn=cmd_abstracts)

    s = sub.add_parser("cite"); s.add_argument("doi")
    s.add_argument("--direction", choices=["both", "backward", "forward"], default="both")
    s.add_argument("--limit", type=int, default=50); s.add_argument("--json")
    s.set_defaults(fn=cmd_cite)

    s = sub.add_parser("fulltext"); s.add_argument("doi"); s.add_argument("--out")
    s.set_defaults(fn=cmd_fulltext)

    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
