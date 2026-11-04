# Search locality normalization

Reported input: Paysandu /17718 returns no matches. Active deployment dpl_D7CzEMBaDM5sWA8wjykAHo4jGWyz is READY at98421e0. Read-only checks: PROTOTYPE_RECORD_ENABLED=true, DATA_MODE=synthetic. Source row Paysandú/17718 and allowlist key exist; profile enabled, initial password gate completed; authenticated SELECT grant and private.can_access RLS policy exist. Actual caller JWT/session access cannot be certified via SQL metadata or the SSO-blocked connector.

Reproduced before fix using HTTP handler fixture: missing result for Paysandu, expected1 actual0. Adapter performed exact accented comparison and fell back to the synthetic catalogue before any prototype query. This independently explains the reported spelling without assuming a missing table or bypassing RLS.

Fix accepts the known locality alias case/diacritic/trim variations for prototype17718, preserving exact parcel digits and canonical key Paysandú. It does not fuzzy-match other localities, change person searches, rewrite stored keys, or weaken RLS. Detail contact/image queries and consultation RPC use the canonical record key after resolution.

HTTP regression covers Paysandu, Paysandú, PAYSANDU, surrounding spaces, decomposed Unicode accent, and unrelated locality rejection. Full local suite24files PASS, typecheck/build PASS. Cloud integration still requires authenticated human check after separately approved deployment. No production writes or deployments in this diagnostic task. Immediate workaround on active version: enter Paysandú with accent, parcel17718.

Separate observation: IMAGE_PROVIDER=catalogue, so private Storage image delivery is not activated; this does not explain empty search results and was not changed here.
