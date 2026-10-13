"""Pydantic models for the API data schema."""

from pydantic import BaseModel


class PortInfo(BaseModel):
    name: str
    shape: list[int] = []


class FunctionInfo(BaseModel):
    type: str
    params: dict = {}
    validTypes: list[str] = []


class MechanismInfo(BaseModel):
    name: str
    kind: str = "mechanism"
    type: str
    inputPorts: list[PortInfo] = []
    outputPorts: list[PortInfo] = []
    params: dict = {}
    function: FunctionInfo | None = None


class GSCInfo(BaseModel):
    """A GraphStructureCondition attached to a node's scheduler."""
    id: str                    # unique ID: "{owner_varName}_gsc_{index}"
    type: str                  # "BeforeNode", "AddEdgeTo", etc.
    owner: str                 # varName of the owner node
    nodes: list[str] = []      # varNames of target nodes
    params: dict = {}          # operation params (owner_senders, etc.)


class ProjectionInfo(BaseModel):
    name: str
    type: str
    sender: dict
    receiver: dict


class CompositionInfo(BaseModel):
    varName: str
    name: str
    kind: str = "composition"
    # Class name of the composition (e.g. "Composition", "AutodiffComposition",
    # "EMComposition") so the frontend can offer Autodiff-only views.
    compositionType: str = "Composition"
    # True iff isinstance(comp, AutodiffComposition) — covers all autodiff
    # subclasses, not just the top-level AutodiffComposition class.
    isAutodiff: bool = False
    nodes: list[dict] = []
    projections: list[ProjectionInfo] = []
    scheduling: list[GSCInfo] = []


class ModelGraph(BaseModel):
    compositions: list[CompositionInfo] = []
