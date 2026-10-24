"""Pydantic mirror of the EditPlan contract (v3, plus v2 for plans saved before tracks).

Source of truth: frontend/lib/edit-plan/schema.ts (v3) and schema-v2.ts (Zod). Keep this file
in lockstep with them. The backend stores whichever version the editor saves; the editor
migrates v2 to v3 when it loads a plan (frontend/lib/edit-plan/migrate.ts).
Python attributes are snake_case; the wire format (aliases) is camelCase, exactly as in Zod.
Like Zod's default `z.object`, unknown keys are dropped rather than rejected.
Zod `.optional()` fields are `X | None = None` here and are omitted from output when None,
so the serialized plan always parses with Zod.
"""

from typing import Annotated, Any, Literal, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    SerializerFunctionWrapHandler,
    model_serializer,
    model_validator,
)
from pydantic.alias_generators import to_camel

NonNeg = Annotated[float, Field(ge=0)]
Positive = Annotated[float, Field(gt=0)]
Unit = Annotated[float, Field(ge=0, le=1)]
Signed = Annotated[float, Field(ge=-1, le=1)]
Color = Annotated[str, Field(pattern=r"^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")]  # #RRGGBB(AA)


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


# --- shared by v2 and v3 ---------------------------------------------------------------------


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


class ClipFrameV2(PlanModel):
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


# --- v2: overlays ----------------------------------------------------------------------------


class ClipV2(PlanModel):
    id: str
    source_id: str
    in_ms: NonNeg
    out_ms: Positive
    speed: Annotated[float, Field(ge=0.25, le=4)]
    volume: Annotated[float, Field(ge=0, le=2)]
    muted: bool
    frame: ClipFrameV2
    crop: ClipCrop
    color: ClipColor


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


class ProgressBarV2(PlanModel):
    enabled: bool
    position: Literal["top", "bottom"]
    color: str


class Overlays(PlanModel):
    texts: list[TextOverlay]
    images: list[ImageOverlay]
    progress_bar: ProgressBarV2


class EditPlanV2(PlanModel):
    version: Literal[2]
    id: str
    title: str
    vibe: Literal["energetic", "clean", "story"]
    canvas: Canvas
    sources: Annotated[list[Source], Field(min_length=1)]
    clips: Annotated[list[ClipV2], Field(min_length=1)]
    cuts: Cuts
    captions: Captions
    zooms: Zooms
    overlays: Overlays
    music: Music
    hook: Hook
    voice: Voice


# --- v3: tracks of items ---------------------------------------------------------------------

AnimationType = Literal[
    "none",
    "fade",
    "pop",
    "slide-up",
    "slide-down",
    "slide-left",
    "slide-right",
    "typewriter",
    "bounce",
]


class AnimationPhase(PlanModel):
    type: AnimationType
    duration_ms: Annotated[float, Field(ge=0, le=5000)]


class ClipAnimation(PlanModel):
    in_: AnimationPhase = Field(alias="in")
    out: AnimationPhase


class Animation(ClipAnimation):
    loop: Literal["none", "pulse", "wiggle"]


class Transform(PlanModel):
    """Center as a fraction of the canvas, scale, rotation in degrees, opacity."""

    x: Unit
    y: Unit
    scale: Annotated[float, Field(ge=0.05, le=10)]
    rotation: Annotated[float, Field(ge=-360, le=360)]
    opacity: Unit


class Transition(PlanModel):
    """Transition from a clip INTO the next one."""

    type: Literal["none", "fade", "slide", "wipe", "zoom", "whip"]
    duration_ms: Annotated[float, Field(ge=0, le=2000)]


class ClipFrame(ClipFrameV2):
    opacity: Unit


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
    animation: ClipAnimation
    transition: Transition | None = None
    audio_detached: bool | None = None


class TextGradient(PlanModel):
    from_: Color = Field(alias="from")
    to: Color
    angle: float


class TextStroke(PlanModel):
    color: Color
    width: Annotated[float, Field(ge=0, le=60)]


class TextShadow(PlanModel):
    color: Color
    blur: Annotated[float, Field(ge=0, le=200)]
    x: float
    y: float


class TextBackground(PlanModel):
    color: Color
    opacity: Unit
    padding: Annotated[float, Field(ge=0, le=400)]
    radius: Annotated[float, Field(ge=0, le=400)]


class TextStyle(PlanModel):
    font_family: str
    font_weight: Annotated[int, Field(ge=100, le=900)]
    italic: bool
    size: Annotated[float, Field(ge=8, le=400)]
    letter_spacing: Annotated[float, Field(ge=-0.5, le=2)]
    line_height: Annotated[float, Field(ge=0.5, le=3)]
    align: Literal["left", "center", "right"]
    case: Literal["none", "upper", "lower", "title"]
    color: Color
    gradient: TextGradient | None = None
    stroke: TextStroke | None = None
    shadow: TextShadow | None = None
    background: TextBackground | None = None


class EmojiElement(PlanModel):
    type: Literal["emoji"]
    emoji: Annotated[str, Field(min_length=1)]


class ShapeElement(PlanModel):
    type: Literal["shape"]
    shape: Literal["rect", "circle", "line", "arrow"]
    fill: Color
    stroke: Color
    stroke_width: Annotated[float, Field(ge=0, le=100)]
    # Both as a fraction of canvas WIDTH.
    width: Annotated[float, Field(ge=0.01, le=2)]
    height: Annotated[float, Field(ge=0.005, le=4)]


class StickerElement(PlanModel):
    type: Literal["sticker"]
    sticker_id: str


Element = Annotated[EmojiElement | ShapeElement | StickerElement, Field(discriminator="type")]


class ItemBase(PlanModel):
    id: str
    start_ms: NonNeg  # output time
    end_ms: NonNeg


class VisualItemBase(ItemBase):
    transform: Transform
    animation: Animation


class TextItem(VisualItemBase):
    kind: Literal["text"]
    text: str
    style: TextStyle
    preset_id: str | None = None


class ElementItem(VisualItemBase):
    kind: Literal["element"]
    element: Element


class ImageItem(VisualItemBase):
    kind: Literal["image"]
    src: str
    width: Annotated[float, Field(ge=0.02, le=1)]  # fraction of canvas width


class SfxItem(ItemBase):
    kind: Literal["sfx"]
    sfx_id: str
    volume: Annotated[float, Field(ge=0, le=2)]
    fade_in_ms: NonNeg
    fade_out_ms: NonNeg


Item = Annotated[TextItem | ElementItem | ImageItem | SfxItem, Field(discriminator="kind")]


class Track(PlanModel):
    """Track order is layer order: the first track is drawn at the bottom."""

    id: str
    kind: Literal["text", "element", "image", "sfx"]
    name: str
    locked: bool
    hidden: bool
    muted: bool
    items: list[Item]

    @model_validator(mode="after")
    def _items_match_kind(self) -> Self:
        if any(item.kind != self.kind for item in self.items):
            raise ValueError("Every item must match its track's kind")
        return self


class CanvasBackgroundV3(CanvasBackground):
    color: Color


class CanvasV3(Canvas):
    background: CanvasBackgroundV3


class ProgressBar(PlanModel):
    enabled: bool
    position: Literal["top", "bottom"]
    color: Color
    thickness: Annotated[float, Field(ge=2, le=60)]


class EditPlanV3(PlanModel):
    version: Literal[3]
    id: str
    title: str
    vibe: Literal["energetic", "clean", "story"]
    canvas: CanvasV3
    sources: Annotated[list[Source], Field(min_length=1)]
    clips: Annotated[list[Clip], Field(min_length=1)]
    cuts: Cuts
    captions: Captions
    zooms: Zooms
    tracks: list[Track]
    progress_bar: ProgressBar
    music: Music
    hook: Hook
    voice: Voice


class EditPlan(RootModel[Annotated[EditPlanV2 | EditPlanV3, Field(discriminator="version")]]):
    """Any supported plan version, chosen by its `version` field."""

    @property
    def version(self) -> int:
        return self.root.version
