"""Pydantic mirror of the EditPlan v2 contract.

Source of truth: frontend/lib/edit-plan/schema.ts (Zod). Keep this file in lockstep with it.
Python attributes are snake_case; the wire format (aliases) is camelCase, exactly as in Zod.
Like Zod's default `z.object`, unknown keys are dropped rather than rejected.
Zod `.optional()` fields are `X | None = None` here and are omitted from output when None,
so the serialized plan always parses with Zod.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SerializerFunctionWrapHandler, model_serializer
from pydantic.alias_generators import to_camel

NonNeg = Annotated[float, Field(ge=0)]
Positive = Annotated[float, Field(gt=0)]
Unit = Annotated[float, Field(ge=0, le=1)]
Signed = Annotated[float, Field(ge=-1, le=1)]


class PlanModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_alias=True,
        validate_by_name=False,
        serialize_by_alias=True,
        strict=True,
    )

    @model_serializer(mode="wrap")
    def _omit_absent_optionals(self, handler: SerializerFunctionWrapHandler) -> Any:
        data = handler(self)
        if isinstance(data, dict):
            for name, field in type(self).model_fields.items():
                if field.default is None and getattr(self, name) is None:
                    data.pop(field.alias or name, None)
                    data.pop(name, None)
        return data


class Word(PlanModel):
    id: str
    text: str
    start_ms: NonNeg
    end_ms: NonNeg
    filler: bool | None = None


class Source(PlanModel):
    id: str
    src: str
    poster: str | None = None
    width: Positive
    height: Positive
    duration_ms: Positive
    words: list[Word]


class ClipFrame(PlanModel):
    fit: Literal["fill", "fit"]
    scale: Annotated[float, Field(ge=0.2, le=4)]
    x: float  # offset as a fraction of canvas width
    y: float  # offset as a fraction of canvas height
    rotate: Literal[0, 90, 180, 270]
    flip_h: bool
    flip_v: bool


class ClipCrop(PlanModel):
    """Fractions (0-0.9) trimmed from each edge; unconstrained in Zod too."""

    left: float
    top: float
    right: float
    bottom: float


class ClipColor(PlanModel):
    preset: Literal["none", "natural", "warm", "cool", "vivid", "mono", "film"]
    brightness: Signed
    contrast: Signed
    saturation: Signed
    temperature: Signed


class Clip(PlanModel):
    id: str
    source_id: str
    in_ms: NonNeg
    out_ms: Positive
    speed: Annotated[float, Field(ge=0.25, le=4)]
    volume: Annotated[float, Field(ge=0, le=2)]
    muted: bool
    frame: ClipFrame
    crop: ClipCrop
    color: ClipColor


CutReason = Literal["silence", "filler", "retake", "manual"]


class Cut(PlanModel):
    id: str
    source_id: str
    start_ms: NonNeg
    end_ms: NonNeg
    reason: CutReason
    note: str | None = None


ZoomStyle = Literal["smooth", "punch", "push", "linear"]


class Zoom(PlanModel):
    id: str
    source_id: str
    start_ms: NonNeg
    end_ms: NonNeg
    scale: Annotated[float, Field(ge=1, le=2)]
    style: ZoomStyle
    focus_x: Unit
    focus_y: Unit


class TextOverlay(PlanModel):
    id: str
    start_ms: NonNeg  # output time
    end_ms: NonNeg
    text: str
    preset_id: str
    x: Unit
    y: Unit
    size: Annotated[float, Field(ge=16, le=240)]
    animation: Literal["none", "fade", "pop", "slide"]


class ImageOverlay(PlanModel):
    id: str
    start_ms: NonNeg
    end_ms: NonNeg
    src: str
    x: Unit
    y: Unit
    width: Annotated[float, Field(ge=0.02, le=1)]  # fraction of canvas width
    opacity: Unit


Aspect = Literal["9:16", "1:1", "4:5", "16:9", "custom"]
CanvasSide = Annotated[int, Field(ge=240, le=4096)]


class CanvasBackground(PlanModel):
    type: Literal["blur", "color"]
    color: str


class Canvas(PlanModel):
    aspect: Aspect
    width: CanvasSide
    height: CanvasSide
    fps: Annotated[int, Field(ge=12, le=60)]
    background: CanvasBackground


class Cuts(PlanModel):
    items: list[Cut]
    silence: bool
    filler: bool
    retake: bool
    restored: list[str]


class Captions(PlanModel):
    enabled: bool
    preset_id: str
    size: Annotated[float, Field(ge=40, le=160)]
    position_y: Annotated[float, Field(ge=0.1, le=0.92)]
    words_per_line: Literal[1, 2, 3]
    show_emojis: bool
    highlights: list[str]
    # Record keys are word ids: never alias-transformed.
    emojis: dict[str, str]
    edits: dict[str, str]


class Zooms(PlanModel):
    enabled: bool
    items: list[Zoom]


class ProgressBar(PlanModel):
    enabled: bool
    position: Literal["top", "bottom"]
    color: str


class Overlays(PlanModel):
    texts: list[TextOverlay]
    images: list[ImageOverlay]
    progress_bar: ProgressBar


class Music(PlanModel):
    track_id: str | None
    volume: Unit
    ducking: bool
    duck_to: Unit
    fade_in_ms: NonNeg
    fade_out_ms: NonNeg


class Hook(PlanModel):
    enabled: bool
    text: str
    options: list[str]
    duration_ms: Positive


class Voice(PlanModel):
    enhance: bool


class EditPlan(PlanModel):
    version: Literal[2]
    id: str
    title: str
    vibe: Literal["energetic", "clean", "story"]
    canvas: Canvas
    sources: Annotated[list[Source], Field(min_length=1)]
    clips: Annotated[list[Clip], Field(min_length=1)]
    cuts: Cuts
    captions: Captions
    zooms: Zooms
    overlays: Overlays
    music: Music
    hook: Hook
    voice: Voice
