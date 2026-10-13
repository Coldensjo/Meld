export namespace adt {
	
	export class Liquid {
	    indexX: number;
	    indexY: number;
	    kind: number;
	    heights: number[];
	    cells: boolean[];
	
	    static createFrom(source: any = {}) {
	        return new Liquid(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.indexX = source["indexX"];
	        this.indexY = source["indexY"];
	        this.kind = source["kind"];
	        this.heights = source["heights"];
	        this.cells = source["cells"];
	    }
	}

}

export namespace main {
	
	export class GameLoginInfo {
	    account: string;
	    hasPassword: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GameLoginInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.account = source["account"];
	        this.hasPassword = source["hasPassword"];
	    }
	}
	export class HeightmapData {
	    side: number;
	    heights: number[];
	
	    static createFrom(source: any = {}) {
	        return new HeightmapData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.side = source["side"];
	        this.heights = source["heights"];
	    }
	}

}

export namespace mapfile {
	
	export class VmangosFolder {
	    dir: string;
	    mapId: number;
	
	    static createFrom(source: any = {}) {
	        return new VmangosFolder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.mapId = source["mapId"];
	    }
	}
	export class ClientRegion {
	    mapName: string;
	    x: number;
	    y: number;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new ClientRegion(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapName = source["mapName"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.size = source["size"];
	    }
	}
	export class PlacedObject {
	    id?: number;
	    parent?: number;
	    type: string;
	    x: number;
	    z: number;
	    yOff: number;
	    rotY: number;
	    scale: number;
	    uid?: number;
	    tiltX?: number;
	    tiltZ?: number;
	
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
	        this.uid = source["uid"];
	        this.tiltX = source["tiltX"];
	        this.tiltZ = source["tiltZ"];
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
	    // Go type: ClientRegion
	    region?: any;
	    // Go type: VmangosFolder
	    vmangos?: any;
	    version?: number;
	    heights: string;
	    weights?: string;
	    chunkSlots?: string;
	    holes?: string;
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
	        this.region = this.convertValues(source["region"], null);
	        this.vmangos = this.convertValues(source["vmangos"], null);
	        this.version = source["version"];
	        this.heights = source["heights"];
	        this.weights = source["weights"];
	        this.chunkSlots = source["chunkSlots"];
	        this.holes = source["holes"];
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
	    holes?: number[];
	
	    static createFrom(source: any = {}) {
	        return new ChunkView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.indexX = source["indexX"];
	        this.indexY = source["indexY"];
	        this.areaId = source["areaId"];
	        this.layers = this.convertValues(source["layers"], LayerView);
	        this.holes = source["holes"];
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
	
	export class MapEntry {
	    ID: number;
	    Dir: string;
	    Type: number;
	    Name: string;
	
	    static createFrom(source: any = {}) {
	        return new MapEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Dir = source["Dir"];
	        this.Type = source["Type"];
	        this.Name = source["Name"];
	    }
	}
	export class ObjectSpec {
	    Type: string;
	    X: number;
	    Y: number;
	    Z: number;
	    RotY: number;
	    TiltX: number;
	    TiltZ: number;
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
	        this.TiltX = source["TiltX"];
	        this.TiltZ = source["TiltZ"];
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
	
	export class ObjectView {
	    uid: number;
	    type: string;
	    x: number;
	    y: number;
	    z: number;
	    rotY: number;
	    tiltX: number;
	    tiltZ: number;
	    scale: number;
	
	    static createFrom(source: any = {}) {
	        return new ObjectView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.uid = source["uid"];
	        this.type = source["type"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.rotY = source["rotY"];
	        this.tiltX = source["tiltX"];
	        this.tiltZ = source["tiltZ"];
	        this.scale = source["scale"];
	    }
	}
	
	export class RegionPaint {
	    chunk: number;
	    textures: string[];
	    weights: string;
	
	    static createFrom(source: any = {}) {
	        return new RegionPaint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chunk = source["chunk"];
	        this.textures = source["textures"];
	        this.weights = source["weights"];
	    }
	}
	export class RegionEdit {
	    mapName: string;
	    x: number;
	    y: number;
	    size: number;
	    heights: number[];
	    objects: ObjectView[];
	    paint: RegionPaint[];
	
	    static createFrom(source: any = {}) {
	        return new RegionEdit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapName = source["mapName"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.size = source["size"];
	        this.heights = source["heights"];
	        this.objects = this.convertValues(source["objects"], ObjectView);
	        this.paint = this.convertValues(source["paint"], RegionPaint);
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
	
	export class RegionView {
	    mapName: string;
	    x: number;
	    y: number;
	    size: number;
	    heights: number[];
	    chunks: ChunkView[];
	    objects: ObjectView[];
	    liquids: adt.Liquid[];
	
	    static createFrom(source: any = {}) {
	        return new RegionView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapName = source["mapName"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.size = source["size"];
	        this.heights = source["heights"];
	        this.chunks = this.convertValues(source["chunks"], ChunkView);
	        this.objects = this.convertValues(source["objects"], ObjectView);
	        this.liquids = this.convertValues(source["liquids"], adt.Liquid);
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
	
	export class WorldSpawn {
	    kind: string;
	    guid: number;
	    entry: number;
	    name: string;
	    subname: string;
	    levelMin: number;
	    levelMax: number;
	    faction: number;
	    npcFlags: number;
	    rank: number;
	    type: number;
	    x: number;
	    y: number;
	    z: number;
	    orientation: number;
	    respawnSecs: number;
	    model: string;
	
	    static createFrom(source: any = {}) {
	        return new WorldSpawn(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.guid = source["guid"];
	        this.entry = source["entry"];
	        this.name = source["name"];
	        this.subname = source["subname"];
	        this.levelMin = source["levelMin"];
	        this.levelMax = source["levelMax"];
	        this.faction = source["faction"];
	        this.npcFlags = source["npcFlags"];
	        this.rank = source["rank"];
	        this.type = source["type"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.orientation = source["orientation"];
	        this.respawnSecs = source["respawnSecs"];
	        this.model = source["model"];
	    }
	}
	export class Zone {
	    MapID: number;
	    Name: string;
	    X0: number;
	    Y0: number;
	    X1: number;
	    Y1: number;
	
	    static createFrom(source: any = {}) {
	        return new Zone(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.MapID = source["MapID"];
	        this.Name = source["Name"];
	        this.X0 = source["X0"];
	        this.Y0 = source["Y0"];
	        this.X1 = source["X1"];
	        this.Y1 = source["Y1"];
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

