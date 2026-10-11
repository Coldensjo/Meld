export namespace adt {
	
	export class Placement {
	    Kind: number;
	    Name: string;
	    UID: number;
	    Position: number[];
	    Rotation: number[];
	    Scale: number;
	    DoodadSet: number;
	    NameSet: number;
	
	    static createFrom(source: any = {}) {
	        return new Placement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Kind = source["Kind"];
	        this.Name = source["Name"];
	        this.UID = source["UID"];
	        this.Position = source["Position"];
	        this.Rotation = source["Rotation"];
	        this.Scale = source["Scale"];
	        this.DoodadSet = source["DoodadSet"];
	        this.NameSet = source["NameSet"];
	    }
	}

}

export namespace mapfile {
	
	export class PlacedObject {
	    id?: number;
	    parent?: number;
	    type: string;
	    x: number;
	    z: number;
	    yOff: number;
	    rotY: number;
	    scale: number;
	
	    static createFrom(source: any = {}) {
	        return new PlacedObject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.parent = source["parent"];
	        this.type = source["type"];
	        this.x = source["x"];
	        this.z = source["z"];
	        this.yOff = source["yOff"];
	        this.rotY = source["rotY"];
	        this.scale = source["scale"];
	    }
	}
	export class MapData {
	    name: string;
	    size: number;
	    cellSize: number;
	    splatRes: number;
	    waterLevel: number;
	    waterEnabled: boolean;
	    objects: PlacedObject[];
	    palette?: string[];
	    layerTextures?: string[];
	    texScale?: number;
	    version?: number;
	    heights: string;
	    weights?: string;
	    chunkSlots?: string;
	    splatA?: string;
	    splatB?: string;
	
	    static createFrom(source: any = {}) {
	        return new MapData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.size = source["size"];
	        this.cellSize = source["cellSize"];
	        this.splatRes = source["splatRes"];
	        this.waterLevel = source["waterLevel"];
	        this.waterEnabled = source["waterEnabled"];
	        this.objects = this.convertValues(source["objects"], PlacedObject);
	        this.palette = source["palette"];
	        this.layerTextures = source["layerTextures"];
	        this.texScale = source["texScale"];
	        this.version = source["version"];
	        this.heights = source["heights"];
	        this.weights = source["weights"];
	        this.chunkSlots = source["chunkSlots"];
	        this.splatA = source["splatA"];
	        this.splatB = source["splatB"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace vmangos {
	
	export class LayerView {
	    texture: string;
	    effect: number;
	    alpha?: string;
	
	    static createFrom(source: any = {}) {
	        return new LayerView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.texture = source["texture"];
	        this.effect = source["effect"];
	        this.alpha = source["alpha"];
	    }
	}
	export class ChunkView {
	    indexX: number;
	    indexY: number;
	    areaId: number;
	    layers: LayerView[];
	
	    static createFrom(source: any = {}) {
	        return new ChunkView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.indexX = source["indexX"];
	        this.indexY = source["indexY"];
	        this.areaId = source["areaId"];
	        this.layers = this.convertValues(source["layers"], LayerView);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ObjectSpec {
	    Type: string;
	    X: number;
	    Y: number;
	    Z: number;
	    RotY: number;
	    Scale: number;
	
	    static createFrom(source: any = {}) {
	        return new ObjectSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Type = source["Type"];
	        this.X = source["X"];
	        this.Y = source["Y"];
	        this.Z = source["Z"];
	        this.RotY = source["RotY"];
	        this.Scale = source["Scale"];
	    }
	}
	export class PaintSpec {
	    Chunk: number;
	    Textures: string[];
	    Weights: string;
	
	    static createFrom(source: any = {}) {
	        return new PaintSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Chunk = source["Chunk"];
	        this.Textures = source["Textures"];
	        this.Weights = source["Weights"];
	    }
	}
	export class TileSpec {
	    X: number;
	    Y: number;
	    Outer: number[];
	    Paint: PaintSpec[];
	    Objects: ObjectSpec[];
	
	    static createFrom(source: any = {}) {
	        return new TileSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.X = source["X"];
	        this.Y = source["Y"];
	        this.Outer = source["Outer"];
	        this.Paint = this.convertValues(source["Paint"], PaintSpec);
	        this.Objects = this.convertValues(source["Objects"], ObjectSpec);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MapSpec {
	    Dir: string;
	    MapID: number;
	    Tiles: TileSpec[];
	    Water: boolean;
	    WaterLevel: number;
	
	    static createFrom(source: any = {}) {
	        return new MapSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Dir = source["Dir"];
	        this.MapID = source["MapID"];
	        this.Tiles = this.convertValues(source["Tiles"], TileSpec);
	        this.Water = source["Water"];
	        this.WaterLevel = source["WaterLevel"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class TileView {
	    mapName: string;
	    x: number;
	    y: number;
	    heights: number[];
	    chunks: ChunkView[];
	    placements: adt.Placement[];
	
	    static createFrom(source: any = {}) {
	        return new TileView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapName = source["mapName"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.heights = source["heights"];
	        this.chunks = this.convertValues(source["chunks"], ChunkView);
	        this.placements = this.convertValues(source["placements"], adt.Placement);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace wow {
	
	export class Status {
	    path: string;
	    loaded: boolean;
	    error: string;
	    files: number;
	    archives: number;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.loaded = source["loaded"];
	        this.error = source["error"];
	        this.files = source["files"];
	        this.archives = source["archives"];
	    }
	}

}

