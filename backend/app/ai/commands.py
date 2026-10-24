"""Edit commands the AI may emit: a Pydantic mirror of a subset of `EditCommand`.

Source of truth: frontend/lib/edit-plan/commands.ts (the `EditCommand` union). Field names on
the wire are camelCase exactly as in TypeScript; every patch field is optional (TS `Partial`),
and unknown keys are rejected because `applyEdit` would copy them into the plan.
Commands the agents never need (clips, tracks, items, transitions) are left out on purpose.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated, Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from pydantic.alias_generators import to_camel

Vibe = Literal["energetic", "clean", "story"]
Aspect = Literal["9:16", "1:1", "4:5", "16:9", "custom"]
ZoomStyle = Literal["smooth", "punch", "push", "linear"]
Ms = Annotated[int | float, Field(ge=0)]  # ints stay ints on the wire
Unit = Annotated[float, Field(ge=0, le=1)]
Color = Annotated[str, Field(pattern=r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")]

# Library ids the editor knows (frontend/lib/edit-plan/music-library.ts, lib/caption-presets.ts).
MUSIC_TRACK_IDS = ("summer-fun", "just-chill", "forest-walk", "epic-drums", "a-new-life")
CAPTION_PRESET_IDS = (
    "bold-pop",
    "clean",
    "karaoke",
    "story",
    "neon",
    "boxed",
    "beast",
    "minimal",
    "gradient",
    "typewriter",
    "comic",
    "pro-subtle",
)


class _Wire(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_alias=True,
        validate_by_name=False,  # wire names only, like the TS shapes
        serialize_by_alias=True,
        extra="forbid",
        strict=True,
    )


# --- patches (TS Partial<...>) -----------------------------------------------------------


class CanvasBackgroundPatch(_Wire):
    type: Literal["blur", "color"]
    color: Color


class CanvasPatch(_Wire):
    aspect: Aspect | None = None
    width: Annotated[int, Field(ge=240, le=4096)] | None = None
    height: Annotated[int, Field(ge=240, le=4096)] | None = None
    fps: Annotated[int, Field(ge=12, le=60)] | None = None
    background: CanvasBackgroundPatch | None = None


class CutRulesPatch(_Wire):
    silence: bool | None = None
    filler: bool | None = None
    retake: bool | None = None


class CaptionsPatch(_Wire):
    enabled: bool | None = None
    preset_id: str | None = None
    size: Annotated[float, Field(ge=40, le=160)] | None = None
    position_y: Annotated[float, Field(ge=0.1, le=0.92)] | None = None
    words_per_line: Literal[1, 2, 3] | None = None
    show_emojis: bool | None = None


class ZoomPatch(_Wire):
    start_ms: Ms | None = None
    end_ms: Ms | None = None
    scale: Annotated[float, Field(ge=1, le=2)] | None = None
    style: ZoomStyle | None = None
    focus_x: Unit | None = None
    focus_y: Unit | None = None


class AllZoomsPatch(_Wire):
    style: ZoomStyle | None = None
    scale: Annotated[float, Field(ge=1, le=2)] | None = None


class ProgressBarPatch(_Wire):
    enabled: bool | None = None
    position: Literal["top", "bottom"] | None = None
    color: Color | None = None
    thickness: Annotated[float, Field(ge=2, le=60)] | None = None


class MusicPatch(_Wire):
    track_id: str | None = None  # null = no music
    volume: Unit | None = None
    ducking: bool | None = None
    duck_to: Unit | None = None
    fade_in_ms: Ms | None = None
    fade_out_ms: Ms | None = None


class VoicePatch(_Wire):
    enhance: bool | None = None


class HookPatch(_Wire):
    enabled: bool | None = None
    text: str | None = None
    options: list[str] | None = None
    duration_ms: Annotated[float, Field(gt=0)] | None = None


# --- commands ----------------------------------------------------------------------------


class SetTitle(_Wire):
    type: Literal["setTitle"]
    title: Annotated[str, Field(min_length=1, max_length=200)]


class SetVibe(_Wire):
    type: Literal["setVibe"]
    vibe: Vibe


class SetCanvas(_Wire):
    type: Literal["setCanvas"]
    canvas: CanvasPatch


class SetCutRules(_Wire):
    type: Literal["setCutRules"]
    rules: CutRulesPatch


class ToggleRestoreCut(_Wire):
    type: Literal["toggleRestoreCut"]
    cut_id: str


class RemoveCut(_Wire):
    type: Literal["removeCut"]
    cut_id: str


class CutRange(_Wire):
    type: Literal["cutRange"]
    source_id: str
    start_ms: Ms
    end_ms: Ms
    note: str | None = None


class ToggleWordCut(_Wire):
    type: Literal["toggleWordCut"]
    source_id: str
    word_id: str


class SetWordText(_Wire):
    type: Literal["setWordText"]
    word_id: str
    text: str


class SetCaptions(_Wire):
    type: Literal["setCaptions"]
    captions: CaptionsPatch


class ToggleHighlight(_Wire):
    type: Literal["toggleHighlight"]
    word_id: str


class SetEmoji(_Wire):
    type: Literal["setEmoji"]
    word_id: str
    emoji: Annotated[str, Field(min_length=1, max_length=16)] | None  # required key, null clears


class SetZoomsEnabled(_Wire):
    type: Literal["setZoomsEnabled"]
    enabled: bool


class AddZoom(_Wire):
    type: Literal["addZoom"]
    source_id: str
    at_ms: Ms
    zoom: ZoomPatch | None = None


class UpdateZoom(_Wire):
    type: Literal["updateZoom"]
    zoom_id: str
    patch: ZoomPatch


class UpdateAllZooms(_Wire):
    type: Literal["updateAllZooms"]
    patch: AllZoomsPatch


class RemoveZoom(_Wire):
    type: Literal["removeZoom"]
    zoom_id: str


class SetProgressBar(_Wire):
    type: Literal["setProgressBar"]
    bar: ProgressBarPatch


class SetMusic(_Wire):
    type: Literal["setMusic"]
    music: MusicPatch


class SetVoice(_Wire):
    type: Literal["setVoice"]
    voice: VoicePatch


class SetHook(_Wire):
    type: Literal["setHook"]
    hook: HookPatch


AgentCommand = Annotated[
    SetTitle
    | SetVibe
    | SetCanvas
    | SetCutRules
    | ToggleRestoreCut
    | RemoveCut
    | CutRange
    | ToggleWordCut
    | SetWordText
    | SetCaptions
    | ToggleHighlight
    | SetEmoji
    | SetZoomsEnabled
    | AddZoom
    | UpdateZoom
    | UpdateAllZooms
    | RemoveZoom
    | SetProgressBar
    | SetMusic
    | SetVoice
    | SetHook,
    Field(discriminator="type"),
]

COMMAND_MODELS: tuple[type[_Wire], ...] = get_args(get_args(AgentCommand)[0])
COMMAND_TYPES: tuple[str, ...] = tuple(
    get_args(m.model_fields["type"].annotation)[0] for m in COMMAND_MODELS
)

_ADAPTER: TypeAdapter[Any] = TypeAdapter(AgentCommand)
_LIST_ADAPTER: TypeAdapter[list[Any]] = TypeAdapter(list[AgentCommand])


def dump_command(command: BaseModel) -> dict[str, Any]:
    """Wire JSON (camelCase), only the fields that were set: exactly a TS `EditCommand`."""
    return command.model_dump(mode="json", by_alias=True, exclude_unset=True)


def dump_commands(commands: Iterable[BaseModel]) -> list[dict[str, Any]]:
    return [dump_command(c) for c in commands]


def parse_command(data: Any) -> BaseModel:
    """One command from wire JSON; raises ValidationError when it is not a valid command."""
    return _ADAPTER.validate_python(data)


@dataclass(frozen=True, slots=True)
class DroppedCommand:
    index: int
    type: str | None
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {"index": self.index, "type": self.type, "reason": self.reason}


def _reason(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors()[:3]:
        loc = ".".join(str(p) for p in err["loc"])
        parts.append(f"{loc}: {err['msg']}" if loc else err["msg"])
    return "; ".join(parts)


def parse_commands(raw: Iterable[Any]) -> tuple[list[BaseModel], list[DroppedCommand]]:
    """Valid commands, plus why each invalid one was dropped (bad output never fails a run)."""
    good: list[BaseModel] = []
    dropped: list[DroppedCommand] = []
    for i, item in enumerate(raw):
        kind = item.get("type") if isinstance(item, dict) else None
        kind = kind if isinstance(kind, str) else None
        if isinstance(item, BaseModel):
            item = dump_command(item)
        if kind is not None and kind not in COMMAND_TYPES:
            dropped.append(DroppedCommand(i, kind, f"unsupported command type {kind!r}"))
            continue
        try:
            good.append(parse_command(item))
        except ValidationError as exc:
            dropped.append(DroppedCommand(i, kind, _reason(exc)))
    return good, dropped


def command_list_json_schema() -> dict[str, Any]:
    """JSON Schema of `EditCommand[]` (the agent subset), wire names."""
    return _LIST_ADAPTER.json_schema(by_alias=True)


def openai_friendly_schema(schema: Any) -> Any:
    """Pydantic JSON Schema tweaked for OpenAI response formats: `oneOf` -> `anyOf` and no
    `discriminator` keyword (both are outside OpenAI's supported subset)."""
    if isinstance(schema, dict):
        out = {}
        for key, value in schema.items():
            if key == "discriminator":
                continue
            out["anyOf" if key == "oneOf" else key] = openai_friendly_schema(value)
        return out
    if isinstance(schema, list):
        return [openai_friendly_schema(v) for v in schema]
    return schema
