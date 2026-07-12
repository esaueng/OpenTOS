from __future__ import annotations

from app.models.platform import StudyDraft, StudyReadiness


def evaluate_readiness(study: StudyDraft) -> StudyReadiness:
    blockers: list[dict[str, str]] = []
    warnings: list[dict[str, str]] = []

    if not study.constraints.designRegion.get("faceIndices"):
        blockers.append({"code": "design_region_required", "field": "constraints.designRegion", "message": "Select a design region."})
    if not study.constraints.preservedRegions:
        blockers.append({"code": "preserved_region_required", "field": "constraints.preservedRegions", "message": "Select at least one preserved interface."})
    if not study.loadCases:
        blockers.append({"code": "load_case_required", "field": "loadCases", "message": "Add at least one load case."})

    fixed_region_ids = {region.id for region in study.constraints.preservedRegions}
    for load_case in study.loadCases:
        if not load_case.forces:
            blockers.append({"code": "force_required", "field": f"loadCases.{load_case.id}", "message": f"{load_case.id} needs at least one force."})
        unknown = [region_id for region_id in load_case.fixedRegions if region_id not in fixed_region_ids]
        if not load_case.fixedRegions:
            blockers.append({"code": "fixed_support_required", "field": f"loadCases.{load_case.id}", "message": f"{load_case.id} needs a fixed support."})
        elif unknown:
            blockers.append({"code": "unknown_fixed_support", "field": f"loadCases.{load_case.id}", "message": f"{load_case.id} references unknown fixed support ids."})

    if study.targets.safetyFactor < 1.2:
        warnings.append({"code": "low_safety_target", "field": "targets.safetyFactor", "message": "A safety target below 1.2 leaves little engineering margin."})
    if study.manufacturing.process == "additive" and study.manufacturing.overhangAngleDeg is None:
        warnings.append({"code": "overhang_unspecified", "field": "manufacturing.overhangAngleDeg", "message": "Additive studies should define an overhang limit."})

    complexity = len(study.constraints.designRegion.get("faceIndices", [])) + sum(len(case.forces) * 100 for case in study.loadCases)
    estimate = max(30, min(900, 90 + complexity // 20))
    return StudyReadiness(ready=not blockers, blockers=blockers, warnings=warnings, estimatedSeconds=estimate)
