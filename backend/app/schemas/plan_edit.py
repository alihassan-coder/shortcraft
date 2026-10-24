from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints

EditRequestText = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
]


class PlanEditRequest(BaseModel):
    """'Describe a change': the creator's request about the plan at `plan_revision`."""

    request: EditRequestText
    plan_revision: Annotated[int, Field(ge=1)]


class PlanEditResponse(BaseModel):
    """Edit commands for the editor to apply with its own `applyEdit` (nothing is saved).

    `commands` are TS `EditCommand`s (camelCase, see frontend/lib/edit-plan/commands.ts);
    `changes` are short lines for the creator. `ok` is false when no command could be made,
    with `message` explaining why. `dropped` lists AI commands removed by validation."""

    ok: bool
    commands: list[dict[str, Any]]
    changes: list[str]
    message: str | None = None
    dropped: list[dict[str, Any]] = []
