export namespace adt {
	
	export class Liquid {
	    indexX: number;
	    indexY: number;
	    type: number;
	    heights: number[];
	    depth: number[];
	    cells: boolean[];
	
	    static createFrom(source: any = {}) {
	        return new Liquid(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.indexX = source["indexX"];
	        this.indexY = source["indexY"];
	        this.type = source["type"];
	        this.heights = source["heights"];
	        this.depth = source["depth"];
	        this.cells = source["cells"];
	    }
	}

}

export namespace config {
	
	export class Project {
	    name: string;
	    path: string;
	    clientPath: string;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.clientPath = source["clientPath"];
	    }
	}

}

export namespace heightmap {
	
	export class GreyView {
	    w: number;
	    h: number;
	    pix: string;
	
	    static createFrom(source: any = {}) {
	        return new GreyView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.w = source["w"];
	        this.h = source["h"];
	        this.pix = source["pix"];
	    }
	}

}

export namespace main {
	
	export class AreaSaveResult {
	    patch: string;
	    server: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AreaSaveResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.patch = source["patch"];
	        this.server = source["server"];
	    }
	}
	export class AreaTriggerList {
	    triggers: vmangos.AreaTrigger[];
	    nextId: number;
	
	    static createFrom(source: any = {}) {
	        return new AreaTriggerList(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.triggers = this.convertValues(source["triggers"], vmangos.AreaTrigger);
	        this.nextId = source["nextId"];
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
	export class ClientSandbox {
	    dataDir: string;
	    realPatch: sandbox.Stamp;
	
	    static createFrom(source: any = {}) {
	        return new ClientSandbox(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dataDir = source["dataDir"];
	        this.realPatch = this.convertValues(source["realPatch"], sandbox.Stamp);
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
	export class GameClientInfo {
	    client: string;
	    benillaPath: string;
	    benillaBuilt: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GameClientInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.client = source["client"];
	        this.benillaPath = source["benillaPath"];
	        this.benillaBuilt = source["benillaBuilt"];
	    }
	}
	export class GameLoginInfo {
	    account: string;
	    hasPassword: boolean;
	    character: string;
	
	    static createFrom(source: any = {}) {
	        return new GameLoginInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.account = source["account"];
	        this.hasPassword = source["hasPassword"];
	        this.character = source["character"];
	    }
	}
	export class GameWindowInfo {
	    mode: string;
	    resolution: string;
	
	    static createFrom(source: any = {}) {
	        return new GameWindowInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.resolution = source["resolution"];
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
	export class IconsExported {
	    written: number;
	    failed: string[];
	
	    static createFrom(source: any = {}) {
	        return new IconsExported(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.written = source["written"];
	        this.failed = source["failed"];
	    }
	}
	export class IconsImported {
	    names: string[];
	    refused: string[];
	    waiting: boolean;
	
	    static createFrom(source: any = {}) {
	        return new IconsImported(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.names = source["names"];
	        this.refused = source["refused"];
	        this.waiting = source["waiting"];
	    }
	}
	export class LightIDs {
	    light: number;
	    params: number;
	
	    static createFrom(source: any = {}) {
	        return new LightIDs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.light = source["light"];
	        this.params = source["params"];
	    }
	}
	export class LoadingScreenResult {
	    row: vmangos.LoadingScreen;
	    patch: string;
	
	    static createFrom(source: any = {}) {
	        return new LoadingScreenResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.row = this.convertValues(source["row"], vmangos.LoadingScreen);
	        this.patch = source["patch"];
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
	export class PrefabFile {
	    name: string;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new PrefabFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.text = source["text"];
	    }
	}
	export class ProjectList {
	    current?: config.Project;
	    recent: config.Project[];
	
	    static createFrom(source: any = {}) {
	        return new ProjectList(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = this.convertValues(source["current"], config.Project);
	        this.recent = this.convertValues(source["recent"], config.Project);
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
	export class SandboxEnded {
	    wasOn: boolean;
	    realUnchanged: boolean;
	    realPatch: sandbox.Stamp;
	
	    static createFrom(source: any = {}) {
	        return new SandboxEnded(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.wasOn = source["wasOn"];
	        this.realUnchanged = source["realUnchanged"];
	        this.realPatch = this.convertValues(source["realPatch"], sandbox.Stamp);
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
	export class SpellSaved {
	    sql: string;
	    iconAdded: string;
	    visual: number;
	    visualAdded: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SpellSaved(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sql = source["sql"];
	        this.iconAdded = source["iconAdded"];
	        this.visual = source["visual"];
	        this.visualAdded = source["visualAdded"];
	    }
	}
	export class WorldMapResult {
	    row: vmangos.WorldMapRow;
	    overlays: vmangos.WorldMapOverlay[];
	    patch: string;
	
	    static createFrom(source: any = {}) {
	        return new WorldMapResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.row = this.convertValues(source["row"], vmangos.WorldMapRow);
	        this.overlays = this.convertValues(source["overlays"], vmangos.WorldMapOverlay);
	        this.patch = source["patch"];
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
	export class ZoneWeatherList {
	    server: boolean;
	    zones: vmangos.ZoneWeather[];
	
	    static createFrom(source: any = {}) {
	        return new ZoneWeatherList(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.server = source["server"];
	        this.zones = this.convertValues(source["zones"], vmangos.ZoneWeather);
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

export namespace mapfile {
	
	export class PathPoint {
	    x: number;
	    y: number;
	    z: number;
	
	    static createFrom(source: any = {}) {
	        return new PathPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	    }
	}
	export class MapPath {
	    id: number;
	    name: string;
	    kind: string;
	    points: PathPoint[];
	    width: number;
	    falloff: number;
	    edge: number;
	    grade: number;
	    texture: string;
	    depth: number;
	    liquid: number;
	    model?: string;
	    spacing: number;
	    turn: number;
	
	    static createFrom(source: any = {}) {
	        return new MapPath(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.points = this.convertValues(source["points"], PathPoint);
	        this.width = source["width"];
	        this.falloff = source["falloff"];
	        this.edge = source["edge"];
	        this.grade = source["grade"];
	        this.texture = source["texture"];
	        this.depth = source["depth"];
	        this.liquid = source["liquid"];
	        this.model = source["model"];
	        this.spacing = source["spacing"];
	        this.turn = source["turn"];
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
	export class ReferenceImage {
	    path: string;
	    mode: string;
	    opacity: number;
	    shown: boolean;
	    x: number;
	    z: number;
	    w: number;
	    h: number;
	    turn: number;
	
	    static createFrom(source: any = {}) {
	        return new ReferenceImage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.mode = source["mode"];
	        this.opacity = source["opacity"];
	        this.shown = source["shown"];
	        this.x = source["x"];
	        this.z = source["z"];
	        this.w = source["w"];
	        this.h = source["h"];
	        this.turn = source["turn"];
	    }
	}
	export class TextureRoles {
	    rock: number;
	    dirt: number;
	
	    static createFrom(source: any = {}) {
	        return new TextureRoles(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rock = source["rock"];
	        this.dirt = source["dirt"];
	    }
	}
	export class VmangosFolder {
	    dir: string;
	    mapId: number;
	    info?: number[];
	
	    static createFrom(source: any = {}) {
	        return new VmangosFolder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dir = source["dir"];
	        this.mapId = source["mapId"];
	        this.info = source["info"];
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
	    group?: number;
	
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
	        this.group = source["group"];
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
	    // Go type: ClientRegion
	    region?: any;
	    // Go type: VmangosFolder
	    vmangos?: any;
	    // Go type: TextureRoles
	    roles?: any;
	    textureEffects?: Record<string, number>;
	    textureLooks?: Record<string, number>;
	    zoneEffects?: Record<string, any>;
	    tileEffects?: Record<string, any>;
	    // Go type: ReferenceImage
	    reference?: any;
	    paths?: MapPath[];
	    liquidsUnknown?: boolean;
	    chunkDataUnknown?: boolean;
	    version?: number;
	    heights: string;
	    weights?: string;
	    chunkSlots?: string;
	    holes?: string;
	    liquids?: string;
	    areaIds?: string;
	    chunkFlags?: string;
	    noEffect?: string;
	    shadows?: string;
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
	        this.region = this.convertValues(source["region"], null);
	        this.vmangos = this.convertValues(source["vmangos"], null);
	        this.roles = this.convertValues(source["roles"], null);
	        this.textureEffects = source["textureEffects"];
	        this.textureLooks = source["textureLooks"];
	        this.zoneEffects = source["zoneEffects"];
	        this.tileEffects = source["tileEffects"];
	        this.reference = this.convertValues(source["reference"], null);
	        this.paths = this.convertValues(source["paths"], MapPath);
	        this.liquidsUnknown = source["liquidsUnknown"];
	        this.chunkDataUnknown = source["chunkDataUnknown"];
	        this.version = source["version"];
	        this.heights = source["heights"];
	        this.weights = source["weights"];
	        this.chunkSlots = source["chunkSlots"];
	        this.holes = source["holes"];
	        this.liquids = source["liquids"];
	        this.areaIds = source["areaIds"];
	        this.chunkFlags = source["chunkFlags"];
	        this.noEffect = source["noEffect"];
	        this.shadows = source["shadows"];
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

export namespace recovery {
	
	export class Info {
	    id: string;
	    session: string;
	    name: string;
	    file: string;
	    region: string;
	    saved: number;
	    fileTime: number;
	
	    static createFrom(source: any = {}) {
	        return new Info(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.session = source["session"];
	        this.name = source["name"];
	        this.file = source["file"];
	        this.region = source["region"];
	        this.saved = source["saved"];
	        this.fileTime = source["fileTime"];
	    }
	}

}

export namespace sandbox {
	
	export class Stamp {
	    size: number;
	    modTime: number;
	
	    static createFrom(source: any = {}) {
	        return new Stamp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.size = source["size"];
	        this.modTime = source["modTime"];
	    }
	}

}

export namespace vmangos {
	
	export class AILine {
	    event: number;
	    chance: number;
	    chat: number;
	    textId: number;
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new AILine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.event = source["event"];
	        this.chance = source["chance"];
	        this.chat = source["chat"];
	        this.textId = source["textId"];
	        this.text = source["text"];
	    }
	}
	export class AnimInfo {
	    id: number;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new AnimInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class Area {
	    id: number;
	    mapId: number;
	    parent: number;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new Area(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.mapId = source["mapId"];
	        this.parent = source["parent"];
	        this.name = source["name"];
	    }
	}
	export class AreaRow {
	    id: number;
	    mapId: number;
	    parent: number;
	    areaBit: number;
	    flags: number;
	    soundPref: number;
	    soundSwim: number;
	    ambience: number;
	    music: number;
	    introMusic: number;
	    level: number;
	    name: string;
	    faction: number;
	    liquid: number;
	    minElevation: number;
	    ambientMul: number;
	    light: number;
	
	    static createFrom(source: any = {}) {
	        return new AreaRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.mapId = source["mapId"];
	        this.parent = source["parent"];
	        this.areaBit = source["areaBit"];
	        this.flags = source["flags"];
	        this.soundPref = source["soundPref"];
	        this.soundSwim = source["soundSwim"];
	        this.ambience = source["ambience"];
	        this.music = source["music"];
	        this.introMusic = source["introMusic"];
	        this.level = source["level"];
	        this.name = source["name"];
	        this.faction = source["faction"];
	        this.liquid = source["liquid"];
	        this.minElevation = source["minElevation"];
	        this.ambientMul = source["ambientMul"];
	        this.light = source["light"];
	    }
	}
	export class TriggerTeleport {
	    map: number;
	    x: number;
	    y: number;
	    z: number;
	    o: number;
	    level: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new TriggerTeleport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.map = source["map"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.o = source["o"];
	        this.level = source["level"];
	        this.message = source["message"];
	    }
	}
	export class AreaTrigger {
	    id: number;
	    mapId: number;
	    x: number;
	    y: number;
	    z: number;
	    radius: number;
	    boxX: number;
	    boxY: number;
	    boxZ: number;
	    boxYaw: number;
	    name: string;
	    teleport?: TriggerTeleport;
	
	    static createFrom(source: any = {}) {
	        return new AreaTrigger(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.mapId = source["mapId"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.radius = source["radius"];
	        this.boxX = source["boxX"];
	        this.boxY = source["boxY"];
	        this.boxZ = source["boxZ"];
	        this.boxYaw = source["boxYaw"];
	        this.name = source["name"];
	        this.teleport = this.convertValues(source["teleport"], TriggerTeleport);
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
	export class CharacterSpot {
	    map: number;
	    x: number;
	    y: number;
	    z: number;
	    o: number;
	
	    static createFrom(source: any = {}) {
	        return new CharacterSpot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.map = source["map"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.o = source["o"];
	    }
	}
	export class LayerView {
	    texture: string;
	    effect: number;
	
	    static createFrom(source: any = {}) {
	        return new LayerView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.texture = source["texture"];
	        this.effect = source["effect"];
	    }
	}
	export class ChunkView {
	    indexX: number;
	    indexY: number;
	    areaId: number;
	    impassable?: boolean;
	    layers: LayerView[];
	    holes?: number[];
	    noEffect?: number[];
	
	    static createFrom(source: any = {}) {
	        return new ChunkView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.indexX = source["indexX"];
	        this.indexY = source["indexY"];
	        this.areaId = source["areaId"];
	        this.impassable = source["impassable"];
	        this.layers = this.convertValues(source["layers"], LayerView);
	        this.holes = source["holes"];
	        this.noEffect = source["noEffect"];
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
	export class ClassLevelStats {
	    level: number;
	    health: number;
	    mana: number;
	    meleeDamage: number;
	    armor: number;
	
	    static createFrom(source: any = {}) {
	        return new ClassLevelStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.level = source["level"];
	        this.health = source["health"];
	        this.mana = source["mana"];
	        this.meleeDamage = source["meleeDamage"];
	        this.armor = source["armor"];
	    }
	}
	export class CreatureSpell {
	    spell: number;
	    probability: number;
	    castTarget: number;
	    targetParam1: number;
	    targetParam2: number;
	    castFlags: number;
	    initialMin: number;
	    initialMax: number;
	    repeatMin: number;
	    repeatMax: number;
	    scriptId: number;
	
	    static createFrom(source: any = {}) {
	        return new CreatureSpell(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.spell = source["spell"];
	        this.probability = source["probability"];
	        this.castTarget = source["castTarget"];
	        this.targetParam1 = source["targetParam1"];
	        this.targetParam2 = source["targetParam2"];
	        this.castFlags = source["castFlags"];
	        this.initialMin = source["initialMin"];
	        this.initialMax = source["initialMax"];
	        this.repeatMin = source["repeatMin"];
	        this.repeatMax = source["repeatMax"];
	        this.scriptId = source["scriptId"];
	    }
	}
	export class CreatureSpells {
	    listId: number;
	    name: string;
	    shared: number;
	    spells: CreatureSpell[];
	
	    static createFrom(source: any = {}) {
	        return new CreatureSpells(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.listId = source["listId"];
	        this.name = source["name"];
	        this.shared = source["shared"];
	        this.spells = this.convertValues(source["spells"], CreatureSpell);
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
	export class CreatureSpellsSaved {
	    listId: number;
	    sql: string;
	
	    static createFrom(source: any = {}) {
	        return new CreatureSpellsSaved(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.listId = source["listId"];
	        this.sql = source["sql"];
	    }
	}
	export class CreatureTemplate {
	    entry: number;
	    name: string;
	    subname: string;
	    levelMin: number;
	    levelMax: number;
	    faction: number;
	    npcFlags: number;
	    rank: number;
	    type: number;
	    display: number;
	    scale: number;
	    equipment: number;
	    model: string;
	    look: string;
	    displayScale: number;
	
	    static createFrom(source: any = {}) {
	        return new CreatureTemplate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.name = source["name"];
	        this.subname = source["subname"];
	        this.levelMin = source["levelMin"];
	        this.levelMax = source["levelMax"];
	        this.faction = source["faction"];
	        this.npcFlags = source["npcFlags"];
	        this.rank = source["rank"];
	        this.type = source["type"];
	        this.display = source["display"];
	        this.scale = source["scale"];
	        this.equipment = source["equipment"];
	        this.model = source["model"];
	        this.look = source["look"];
	        this.displayScale = source["displayScale"];
	    }
	}
	export class DisplayEntry {
	    id: number;
	    model: string;
	    look: string;
	    scale: number;
	    skin: string;
	    humanoid: boolean;
	    type: number;
	    names: string[];
	    uses: number;
	
	    static createFrom(source: any = {}) {
	        return new DisplayEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.model = source["model"];
	        this.look = source["look"];
	        this.scale = source["scale"];
	        this.skin = source["skin"];
	        this.humanoid = source["humanoid"];
	        this.type = source["type"];
	        this.names = source["names"];
	        this.uses = source["uses"];
	    }
	}
	export class EdgeSegment {
	    side: string;
	    offset: number;
	    heights: number[];
	
	    static createFrom(source: any = {}) {
	        return new EdgeSegment(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.side = source["side"];
	        this.offset = source["offset"];
	        this.heights = source["heights"];
	    }
	}
	export class Emote {
	    id: number;
	    name: string;
	    anim: number;
	
	    static createFrom(source: any = {}) {
	        return new Emote(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.anim = source["anim"];
	    }
	}
	export class EquipBonusSpell {
	    spell: number;
	    amount: number;
	
	    static createFrom(source: any = {}) {
	        return new EquipBonusSpell(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.spell = source["spell"];
	        this.amount = source["amount"];
	    }
	}
	export class EquipBonusKind {
	    id: string;
	    name: string;
	    unit: string;
	    amounts: EquipBonusSpell[];
	
	    static createFrom(source: any = {}) {
	        return new EquipBonusKind(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.unit = source["unit"];
	        this.amounts = this.convertValues(source["amounts"], EquipBonusSpell);
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
	
	export class FactionInfo {
	    id: number;
	    name: string;
	    alliance: string;
	    horde: string;
	
	    static createFrom(source: any = {}) {
	        return new FactionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.alliance = source["alliance"];
	        this.horde = source["horde"];
	    }
	}
	export class GUIDRow {
	    guid: number;
	    entry: number;
	    map: number;
	
	    static createFrom(source: any = {}) {
	        return new GUIDRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.guid = source["guid"];
	        this.entry = source["entry"];
	        this.map = source["map"];
	    }
	}
	export class GameEvent {
	    id: number;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new GameEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class GossipOption {
	    id: number;
	    icon: number;
	    text: string;
	    broadcastText: number;
	    action: number;
	    npcFlag: number;
	    actionMenu: number;
	    actionPoi: number;
	    actionScript: number;
	    boxCoded: boolean;
	    boxMoney: number;
	    boxText: string;
	    boxBroadcastText: number;
	    condition: number;
	
	    static createFrom(source: any = {}) {
	        return new GossipOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.icon = source["icon"];
	        this.text = source["text"];
	        this.broadcastText = source["broadcastText"];
	        this.action = source["action"];
	        this.npcFlag = source["npcFlag"];
	        this.actionMenu = source["actionMenu"];
	        this.actionPoi = source["actionPoi"];
	        this.actionScript = source["actionScript"];
	        this.boxCoded = source["boxCoded"];
	        this.boxMoney = source["boxMoney"];
	        this.boxText = source["boxText"];
	        this.boxBroadcastText = source["boxBroadcastText"];
	        this.condition = source["condition"];
	    }
	}
	export class GossipText {
	    textId: number;
	    condition: number;
	    male: string;
	    female: string;
	
	    static createFrom(source: any = {}) {
	        return new GossipText(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.textId = source["textId"];
	        this.condition = source["condition"];
	        this.male = source["male"];
	        this.female = source["female"];
	    }
	}
	export class Gossip {
	    menuId: number;
	    shared: number;
	    npcFlags: number;
	    texts: GossipText[];
	    options: GossipOption[];
	    lines: AILine[];
	
	    static createFrom(source: any = {}) {
	        return new Gossip(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.menuId = source["menuId"];
	        this.shared = source["shared"];
	        this.npcFlags = source["npcFlags"];
	        this.texts = this.convertValues(source["texts"], GossipText);
	        this.options = this.convertValues(source["options"], GossipOption);
	        this.lines = this.convertValues(source["lines"], AILine);
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
	
	
	export class GreetingSaved {
	    menuId: number;
	    sql: string;
	
	    static createFrom(source: any = {}) {
	        return new GreetingSaved(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.menuId = source["menuId"];
	        this.sql = source["sql"];
	    }
	}
	export class GroundEffect {
	    doodads: string[];
	    slots: number[];
	    density: number;
	    terrain: number;
	
	    static createFrom(source: any = {}) {
	        return new GroundEffect(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.doodads = source["doodads"];
	        this.slots = source["slots"];
	        this.density = source["density"];
	        this.terrain = source["terrain"];
	    }
	}
	export class TerrainType {
	    id: number;
	    name: string;
	    footprints: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TerrainType(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.footprints = source["footprints"];
	    }
	}
	export class GroundEffectTables {
	    terrains: TerrainType[];
	    effects: Record<number, GroundEffect>;
	    textures: Record<string, number>;
	
	    static createFrom(source: any = {}) {
	        return new GroundEffectTables(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.terrains = this.convertValues(source["terrains"], TerrainType);
	        this.effects = this.convertValues(source["effects"], GroundEffect, true);
	        this.textures = source["textures"];
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
	export class HeaderSpec {
	    chunk: number;
	    areaId: number;
	    impassable: boolean;
	    noEffect?: number[];
	    holes?: number[];
	    shadow?: number[];
	
	    static createFrom(source: any = {}) {
	        return new HeaderSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chunk = source["chunk"];
	        this.areaId = source["areaId"];
	        this.impassable = source["impassable"];
	        this.noEffect = source["noEffect"];
	        this.holes = source["holes"];
	        this.shadow = source["shadow"];
	    }
	}
	export class HorizonTile {
	    dx: number;
	    dy: number;
	    heights: number[];
	
	    static createFrom(source: any = {}) {
	        return new HorizonTile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dx = source["dx"];
	        this.dy = source["dy"];
	        this.heights = source["heights"];
	    }
	}
	export class IconDisplay {
	    id: number;
	    added: boolean;
	
	    static createFrom(source: any = {}) {
	        return new IconDisplay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.added = source["added"];
	    }
	}
	export class ItemDisplayEntry {
	    id: number;
	    icon: string;
	    model: string;
	    kind: string;
	    uses: number;
	    names: string[];
	    path: string;
	    skin: string;
	    visual: number;
	    shoots: number;
	
	    static createFrom(source: any = {}) {
	        return new ItemDisplayEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.icon = source["icon"];
	        this.model = source["model"];
	        this.kind = source["kind"];
	        this.uses = source["uses"];
	        this.names = source["names"];
	        this.path = source["path"];
	        this.skin = source["skin"];
	        this.visual = source["visual"];
	        this.shoots = source["shoots"];
	    }
	}
	export class ItemImportRow {
	    entry: number;
	    patch: number;
	    name: string;
	    exists: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ItemImportRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.patch = source["patch"];
	        this.name = source["name"];
	        this.exists = source["exists"];
	    }
	}
	export class ItemImport {
	    items: ItemImportRow[];
	    skipped: number;
	    unknown: string[];
	
	    static createFrom(source: any = {}) {
	        return new ItemImport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], ItemImportRow);
	        this.skipped = source["skipped"];
	        this.unknown = source["unknown"];
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
	
	export class ItemKind {
	    class: number;
	    subclass: number;
	    invType: number;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new ItemKind(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.class = source["class"];
	        this.subclass = source["subclass"];
	        this.invType = source["invType"];
	        this.count = source["count"];
	    }
	}
	export class ItemLook {
	    model: string;
	    look: string;
	    scale: number;
	    shown: boolean;
	    item: string;
	    itemLook: string;
	
	    static createFrom(source: any = {}) {
	        return new ItemLook(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model = source["model"];
	        this.look = source["look"];
	        this.scale = source["scale"];
	        this.shown = source["shown"];
	        this.item = source["item"];
	        this.itemLook = source["itemLook"];
	    }
	}
	export class ItemRef {
	    entry: number;
	    name: string;
	    quality: number;
	    displayId: number;
	
	    static createFrom(source: any = {}) {
	        return new ItemRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.name = source["name"];
	        this.quality = source["quality"];
	        this.displayId = source["displayId"];
	    }
	}
	export class ItemSetBonus {
	    spell: number;
	    threshold: number;
	
	    static createFrom(source: any = {}) {
	        return new ItemSetBonus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.spell = source["spell"];
	        this.threshold = source["threshold"];
	    }
	}
	export class ItemSet {
	    id: number;
	    name: string;
	    items: number[];
	    bonuses: ItemSetBonus[];
	    requiredSkill: number;
	    requiredSkillRank: number;
	
	    static createFrom(source: any = {}) {
	        return new ItemSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.items = source["items"];
	        this.bonuses = this.convertValues(source["bonuses"], ItemSetBonus);
	        this.requiredSkill = source["requiredSkill"];
	        this.requiredSkillRank = source["requiredSkillRank"];
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
	
	
	export class LightKey {
	    t: number;
	    v: number;
	
	    static createFrom(source: any = {}) {
	        return new LightKey(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.t = source["t"];
	        this.v = source["v"];
	    }
	}
	export class LightParamSet {
	    id: number;
	    highlightSky: boolean;
	    glow: number;
	    waterAlpha: number[];
	    oceanAlpha: number[];
	    colors: LightKey[][];
	    floats: LightKey[][];
	
	    static createFrom(source: any = {}) {
	        return new LightParamSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.highlightSky = source["highlightSky"];
	        this.glow = source["glow"];
	        this.waterAlpha = source["waterAlpha"];
	        this.oceanAlpha = source["oceanAlpha"];
	        this.colors = this.convertValues(source["colors"], LightKey);
	        this.floats = this.convertValues(source["floats"], LightKey);
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
	export class MapLight {
	    id: number;
	    x: number;
	    y: number;
	    z: number;
	    inner: number;
	    outer: number;
	    global: boolean;
	    params: number[];
	
	    static createFrom(source: any = {}) {
	        return new MapLight(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.inner = source["inner"];
	        this.outer = source["outer"];
	        this.global = source["global"];
	        this.params = source["params"];
	    }
	}
	export class LightsEdit {
	    mapId: number;
	    lights: MapLight[];
	    params: LightParamSet[];
	
	    static createFrom(source: any = {}) {
	        return new LightsEdit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapId = source["mapId"];
	        this.lights = this.convertValues(source["lights"], MapLight);
	        this.params = this.convertValues(source["params"], LightParamSet);
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
	export class LiquidTypeEntry {
	    id: number;
	    name: string;
	    kind: number;
	    spell: number;
	
	    static createFrom(source: any = {}) {
	        return new LiquidTypeEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.spell = source["spell"];
	    }
	}
	export class LoadingScreen {
	    id: number;
	    name: string;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new LoadingScreen(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	    }
	}
	export class LoadingScreenSpec {
	    mapId: number;
	    dir: string;
	    pixels: number[];
	
	    static createFrom(source: any = {}) {
	        return new LoadingScreenSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapId = source["mapId"];
	        this.dir = source["dir"];
	        this.pixels = source["pixels"];
	    }
	}
	export class LookResult {
	    model: string;
	    look: string;
	    anim: number;
	    displayScale: number;
	
	    static createFrom(source: any = {}) {
	        return new LookResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model = source["model"];
	        this.look = source["look"];
	        this.anim = source["anim"];
	        this.displayScale = source["displayScale"];
	    }
	}
	export class LootItem {
	    item: number;
	    name: string;
	    quality: number;
	    displayId: number;
	    chance: number;
	    group: number;
	    minCount: number;
	    maxCount: number;
	    condition: number;
	    patchMin: number;
	    patchMax: number;
	
	    static createFrom(source: any = {}) {
	        return new LootItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.item = source["item"];
	        this.name = source["name"];
	        this.quality = source["quality"];
	        this.displayId = source["displayId"];
	        this.chance = source["chance"];
	        this.group = source["group"];
	        this.minCount = source["minCount"];
	        this.maxCount = source["maxCount"];
	        this.condition = source["condition"];
	        this.patchMin = source["patchMin"];
	        this.patchMax = source["patchMax"];
	    }
	}
	export class LootUser {
	    entry: number;
	    name: string;
	    spawns: number;
	
	    static createFrom(source: any = {}) {
	        return new LootUser(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.name = source["name"];
	        this.spawns = source["spawns"];
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
	export class MapInfo {
	    type: number;
	    name?: string;
	    areaId: number;
	    loadingScreen: number;
	    maxPlayers: number;
	    ghostMap: number;
	    ghostX: number;
	    ghostY: number;
	
	    static createFrom(source: any = {}) {
	        return new MapInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.name = source["name"];
	        this.areaId = source["areaId"];
	        this.loadingScreen = source["loadingScreen"];
	        this.maxPlayers = source["maxPlayers"];
	        this.ghostMap = source["ghostMap"];
	        this.ghostX = source["ghostX"];
	        this.ghostY = source["ghostY"];
	    }
	}
	
	export class MapLights {
	    mapId: number;
	    lights: MapLight[];
	    params: Record<number, LightParamSet>;
	
	    static createFrom(source: any = {}) {
	        return new MapLights(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapId = source["mapId"];
	        this.lights = this.convertValues(source["lights"], MapLight);
	        this.params = this.convertValues(source["params"], LightParamSet, true);
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
	    Effects: number[];
	    Flags: number[];
	    NoEffect: number[];
	
	    static createFrom(source: any = {}) {
	        return new PaintSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Chunk = source["Chunk"];
	        this.Textures = source["Textures"];
	        this.Weights = source["Weights"];
	        this.Effects = source["Effects"];
	        this.Flags = source["Flags"];
	        this.NoEffect = source["NoEffect"];
	    }
	}
	export class TileSpec {
	    X: number;
	    Y: number;
	    Outer: string;
	    Paint: PaintSpec[];
	    Objects: ObjectSpec[];
	    Liquids: adt.Liquid[];
	    Headers: HeaderSpec[];
	
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
	        this.Liquids = this.convertValues(source["Liquids"], adt.Liquid);
	        this.Headers = this.convertValues(source["Headers"], HeaderSpec);
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
	    Info?: MapInfo;
	    Global?: ObjectSpec;
	
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
	        this.Info = this.convertValues(source["Info"], MapInfo);
	        this.Global = this.convertValues(source["Global"], ObjectSpec);
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
	export class MinimapTile {
	    x: number;
	    y: number;
	    pixels: number[];
	
	    static createFrom(source: any = {}) {
	        return new MinimapTile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.pixels = source["pixels"];
	    }
	}
	export class NamedID {
	    id: number;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new NamedID(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class ObjectLoot {
	    loot: number;
	    items: LootItem[];
	    users: LootUser[];
	    spawns: number;
	
	    static createFrom(source: any = {}) {
	        return new ObjectLoot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.loot = source["loot"];
	        this.items = this.convertValues(source["items"], LootItem);
	        this.users = this.convertValues(source["users"], LootUser);
	        this.spawns = source["spawns"];
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
	
	export class ObjectTemplate {
	    entry: number;
	    name: string;
	    type: number;
	    display: number;
	    size: number;
	    model: string;
	
	    static createFrom(source: any = {}) {
	        return new ObjectTemplate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.display = source["display"];
	        this.size = source["size"];
	        this.model = source["model"];
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
	
	export class QuestDeleteCount {
	    table: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new QuestDeleteCount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.table = source["table"];
	        this.count = source["count"];
	    }
	}
	export class QuestLink {
	    quest: number;
	    title: string;
	    columns: string[];
	
	    static createFrom(source: any = {}) {
	        return new QuestLink(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.quest = source["quest"];
	        this.title = source["title"];
	        this.columns = source["columns"];
	    }
	}
	export class QuestDeletePlan {
	    title: string;
	    rows: QuestDeleteCount[];
	    links: QuestLink[];
	    characters: number;
	
	    static createFrom(source: any = {}) {
	        return new QuestDeletePlan(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.title = source["title"];
	        this.rows = this.convertValues(source["rows"], QuestDeleteCount);
	        this.links = this.convertValues(source["links"], QuestLink);
	        this.characters = source["characters"];
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
	export class QuestGiver {
	    kind: string;
	    id: number;
	    name: string;
	    patchMin: number;
	    patchMax: number;
	    ready: boolean;
	    spawns: number;
	
	    static createFrom(source: any = {}) {
	        return new QuestGiver(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.id = source["id"];
	        this.name = source["name"];
	        this.patchMin = source["patchMin"];
	        this.patchMax = source["patchMax"];
	        this.ready = source["ready"];
	        this.spawns = source["spawns"];
	    }
	}
	export class QuestGivers {
	    starts: QuestGiver[];
	    ends: QuestGiver[];
	
	    static createFrom(source: any = {}) {
	        return new QuestGivers(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.starts = this.convertValues(source["starts"], QuestGiver);
	        this.ends = this.convertValues(source["ends"], QuestGiver);
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
	
	export class QuestRef {
	    quest: number;
	    title: string;
	    level: number;
	    patchMin: number;
	    patchMax: number;
	
	    static createFrom(source: any = {}) {
	        return new QuestRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.quest = source["quest"];
	        this.title = source["title"];
	        this.level = source["level"];
	        this.patchMin = source["patchMin"];
	        this.patchMax = source["patchMax"];
	    }
	}
	export class QuestLists {
	    starts: QuestRef[];
	    ends: QuestRef[];
	
	    static createFrom(source: any = {}) {
	        return new QuestLists(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.starts = this.convertValues(source["starts"], QuestRef);
	        this.ends = this.convertValues(source["ends"], QuestRef);
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
	
	export class QuestTables {
	    sorts: NamedID[];
	    skills: NamedID[];
	    factions: NamedID[];
	
	    static createFrom(source: any = {}) {
	        return new QuestTables(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sorts = this.convertValues(source["sorts"], NamedID);
	        this.skills = this.convertValues(source["skills"], NamedID);
	        this.factions = this.convertValues(source["factions"], NamedID);
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
	export class RegionPaint {
	    chunk: number;
	    textures: string[];
	    weights: string;
	    effects?: number[];
	    flags?: number[];
	    noEffect?: number[];
	
	    static createFrom(source: any = {}) {
	        return new RegionPaint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chunk = source["chunk"];
	        this.textures = source["textures"];
	        this.weights = source["weights"];
	        this.effects = source["effects"];
	        this.flags = source["flags"];
	        this.noEffect = source["noEffect"];
	    }
	}
	export class RegionEdit {
	    mapName: string;
	    x: number;
	    y: number;
	    size: number;
	    heights: string;
	    objects: ObjectView[];
	    paint: RegionPaint[];
	    hasLiquids: boolean;
	    liquids: adt.Liquid[];
	    partialLiquids: boolean;
	    headers: HeaderSpec[];
	
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
	        this.hasLiquids = source["hasLiquids"];
	        this.liquids = this.convertValues(source["liquids"], adt.Liquid);
	        this.partialLiquids = source["partialLiquids"];
	        this.headers = this.convertValues(source["headers"], HeaderSpec);
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
	export class RegionInner {
	    side: number;
	    lifts: string;
	    base: string;
	
	    static createFrom(source: any = {}) {
	        return new RegionInner(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.side = source["side"];
	        this.lifts = source["lifts"];
	        this.base = source["base"];
	    }
	}
	
	export class RegionResult {
	    patch: string;
	    tiles: number;
	    changed: number;
	    outside: number;
	    changedTiles: string[];
	    mapId: number;
	    tilesCurrent: boolean;
	    building: boolean;
	    wdt: boolean;
	    files: number;
	
	    static createFrom(source: any = {}) {
	        return new RegionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.patch = source["patch"];
	        this.tiles = source["tiles"];
	        this.changed = source["changed"];
	        this.outside = source["outside"];
	        this.changedTiles = source["changedTiles"];
	        this.mapId = source["mapId"];
	        this.tilesCurrent = source["tilesCurrent"];
	        this.building = source["building"];
	        this.wdt = source["wdt"];
	        this.files = source["files"];
	    }
	}
	export class RegionShadows {
	    side: number;
	    bits: string;
	
	    static createFrom(source: any = {}) {
	        return new RegionShadows(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.side = source["side"];
	        this.bits = source["bits"];
	    }
	}
	export class RegionView {
	    mapName: string;
	    x: number;
	    y: number;
	    size: number;
	    heights: string;
	    chunks: ChunkView[];
	    objects: ObjectView[];
	    liquids: adt.Liquid[];
	    alphaUrl: string;
	    wmoOnly: boolean;
	    bounds?: number[];
	
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
	        this.alphaUrl = source["alphaUrl"];
	        this.wmoOnly = source["wmoOnly"];
	        this.bounds = source["bounds"];
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
	export class Result {
	    sql: string;
	    added: number;
	    changed: number;
	    deleted: number;
	    skipped: string[];
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sql = source["sql"];
	        this.added = source["added"];
	        this.changed = source["changed"];
	        this.deleted = source["deleted"];
	        this.skipped = source["skipped"];
	    }
	}
	export class SoundOption {
	    id: number;
	    name: string;
	    file: string;
	
	    static createFrom(source: any = {}) {
	        return new SoundOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.file = source["file"];
	    }
	}
	export class Waypoint {
	    x: number;
	    y: number;
	    z: number;
	    orientation: number;
	    waitMs: number;
	    wanderDistance: number;
	    scriptId: number;
	
	    static createFrom(source: any = {}) {
	        return new Waypoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.orientation = source["orientation"];
	        this.waitMs = source["waitMs"];
	        this.wanderDistance = source["wanderDistance"];
	        this.scriptId = source["scriptId"];
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
	    tilt: number[];
	    respawnSecs: number;
	    respawnMaxSecs: number;
	    display: number;
	    model: string;
	    look: string;
	    anim: number;
	    scale: number;
	    displayScale: number;
	    equipment: number;
	    equipItems: number[];
	    standState: number;
	    emoteState: number;
	    sheathState: number;
	    movementType: number;
	    wanderDistance: number;
	    waypoints: Waypoint[];
	    pathFromTemplate: boolean;
	    events: number[];
	    pool: number;
	    poolLimit: number;
	    poolName: string;
	    poolChance: number;
	    poolElsewhere: number;
	    motherPool: number;
	    motherLimit: number;
	    motherSize: number;
	    motherName: string;
	    leader: number;
	    followDist: number;
	    followAngle: number;
	    groupFlags: number;
	
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
	        this.tilt = source["tilt"];
	        this.respawnSecs = source["respawnSecs"];
	        this.respawnMaxSecs = source["respawnMaxSecs"];
	        this.display = source["display"];
	        this.model = source["model"];
	        this.look = source["look"];
	        this.anim = source["anim"];
	        this.scale = source["scale"];
	        this.displayScale = source["displayScale"];
	        this.equipment = source["equipment"];
	        this.equipItems = source["equipItems"];
	        this.standState = source["standState"];
	        this.emoteState = source["emoteState"];
	        this.sheathState = source["sheathState"];
	        this.movementType = source["movementType"];
	        this.wanderDistance = source["wanderDistance"];
	        this.waypoints = this.convertValues(source["waypoints"], Waypoint);
	        this.pathFromTemplate = source["pathFromTemplate"];
	        this.events = source["events"];
	        this.pool = source["pool"];
	        this.poolLimit = source["poolLimit"];
	        this.poolName = source["poolName"];
	        this.poolChance = source["poolChance"];
	        this.poolElsewhere = source["poolElsewhere"];
	        this.motherPool = source["motherPool"];
	        this.motherLimit = source["motherLimit"];
	        this.motherSize = source["motherSize"];
	        this.motherName = source["motherName"];
	        this.leader = source["leader"];
	        this.followDist = source["followDist"];
	        this.followAngle = source["followAngle"];
	        this.groupFlags = source["groupFlags"];
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
	export class SpawnEdit {
	    spawn: WorldSpawn;
	    original?: WorldSpawn;
	    created: boolean;
	    deleted: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SpawnEdit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.spawn = this.convertValues(source["spawn"], WorldSpawn);
	        this.original = this.convertValues(source["original"], WorldSpawn);
	        this.created = source["created"];
	        this.deleted = source["deleted"];
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
	export class SpawnIDQuery {
	    creatureGuids: number[];
	    objectGuids: number[];
	    creatureEntries: number[];
	    objectEntries: number[];
	
	    static createFrom(source: any = {}) {
	        return new SpawnIDQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.creatureGuids = source["creatureGuids"];
	        this.objectGuids = source["objectGuids"];
	        this.creatureEntries = source["creatureEntries"];
	        this.objectEntries = source["objectEntries"];
	    }
	}
	export class SpawnIDReport {
	    creatures: GUIDRow[];
	    objects: GUIDRow[];
	    missingCreatureEntries: number[];
	    missingObjectEntries: number[];
	
	    static createFrom(source: any = {}) {
	        return new SpawnIDReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.creatures = this.convertValues(source["creatures"], GUIDRow);
	        this.objects = this.convertValues(source["objects"], GUIDRow);
	        this.missingCreatureEntries = source["missingCreatureEntries"];
	        this.missingObjectEntries = source["missingObjectEntries"];
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
	export class SpawnTeleport {
	    label: string;
	    dest: TriggerTeleport;
	
	    static createFrom(source: any = {}) {
	        return new SpawnTeleport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.dest = this.convertValues(source["dest"], TriggerTeleport);
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
	export class SpellCategory {
	    key: string;
	    name: string;
	    group: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new SpellCategory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.name = source["name"];
	        this.group = source["group"];
	        this.count = source["count"];
	    }
	}
	export class SpellImportRow {
	    entry: number;
	    build: number;
	    name: string;
	    exists: boolean;
	    inClient: boolean;
	    newer: boolean;
	    missingIcon: number;
	    missingVisual: number;
	    newIcon: number;
	    newVisual: number;
	
	    static createFrom(source: any = {}) {
	        return new SpellImportRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.build = source["build"];
	        this.name = source["name"];
	        this.exists = source["exists"];
	        this.inClient = source["inClient"];
	        this.newer = source["newer"];
	        this.missingIcon = source["missingIcon"];
	        this.missingVisual = source["missingVisual"];
	        this.newIcon = source["newIcon"];
	        this.newVisual = source["newVisual"];
	    }
	}
	export class SpellImport {
	    spells: SpellImportRow[];
	    skipped: number;
	    unknown: string[];
	    adds: string[];
	
	    static createFrom(source: any = {}) {
	        return new SpellImport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.spells = this.convertValues(source["spells"], SpellImportRow);
	        this.skipped = source["skipped"];
	        this.unknown = source["unknown"];
	        this.adds = source["adds"];
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
	
	export class SpellRef {
	    id: number;
	    name: string;
	    rank: string;
	    icon: string;
	    text: string;
	    visual: number;
	
	    static createFrom(source: any = {}) {
	        return new SpellRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.rank = source["rank"];
	        this.icon = source["icon"];
	        this.text = source["text"];
	        this.visual = source["visual"];
	    }
	}
	export class SpellList {
	    spells: SpellRef[];
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new SpellList(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.spells = this.convertValues(source["spells"], SpellRef);
	        this.total = source["total"];
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
	export class SpellOption {
	    id: number;
	    label: string;
	    value: number;
	    scaled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SpellOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.value = source["value"];
	        this.scaled = source["scaled"];
	    }
	}
	export class TemplateColumn {
	    name: string;
	    kind: string;
	    nullable: boolean;
	    maxLen: number;
	    min: number;
	    max: number;
	
	    static createFrom(source: any = {}) {
	        return new TemplateColumn(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.nullable = source["nullable"];
	        this.maxLen = source["maxLen"];
	        this.min = source["min"];
	        this.max = source["max"];
	    }
	}
	export class SpellRecord {
	    entry: number;
	    build: number;
	    columns: TemplateColumn[];
	    values: Record<string, string>;
	    icon: string;
	    inClient: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SpellRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.build = source["build"];
	        this.columns = this.convertValues(source["columns"], TemplateColumn);
	        this.values = source["values"];
	        this.icon = source["icon"];
	        this.inClient = source["inClient"];
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
	
	export class SpellStarter {
	    id: string;
	    name: string;
	    text: string;
	    like: string;
	
	    static createFrom(source: any = {}) {
	        return new SpellStarter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.text = source["text"];
	        this.like = source["like"];
	    }
	}
	export class SpellTables {
	    castTimes: SpellOption[];
	    durations: SpellOption[];
	    ranges: SpellOption[];
	    radii: SpellOption[];
	
	    static createFrom(source: any = {}) {
	        return new SpellTables(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.castTimes = this.convertValues(source["castTimes"], SpellOption);
	        this.durations = this.convertValues(source["durations"], SpellOption);
	        this.ranges = this.convertValues(source["ranges"], SpellOption);
	        this.radii = this.convertValues(source["radii"], SpellOption);
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
	export class TaxiPoint {
	    mapId: number;
	    x: number;
	    y: number;
	    z: number;
	    flags: number;
	    delay: number;
	
	    static createFrom(source: any = {}) {
	        return new TaxiPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mapId = source["mapId"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.flags = source["flags"];
	        this.delay = source["delay"];
	    }
	}
	export class TaxiRoute {
	    id: number;
	    from: number;
	    to: number;
	    cost: number;
	    points: TaxiPoint[];
	
	    static createFrom(source: any = {}) {
	        return new TaxiRoute(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.from = source["from"];
	        this.to = source["to"];
	        this.cost = source["cost"];
	        this.points = this.convertValues(source["points"], TaxiPoint);
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
	export class TaxiNode {
	    id: number;
	    mapId: number;
	    x: number;
	    y: number;
	    z: number;
	    name: string;
	    hordeMount: number;
	    allianceMount: number;
	
	    static createFrom(source: any = {}) {
	        return new TaxiNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.mapId = source["mapId"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.name = source["name"];
	        this.hordeMount = source["hordeMount"];
	        this.allianceMount = source["allianceMount"];
	    }
	}
	export class TaxiEdit {
	    nodes: TaxiNode[];
	    removeNodes: number[];
	    routes: TaxiRoute[];
	    removeRoutes: number[];
	
	    static createFrom(source: any = {}) {
	        return new TaxiEdit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodes = this.convertValues(source["nodes"], TaxiNode);
	        this.removeNodes = source["removeNodes"];
	        this.routes = this.convertValues(source["routes"], TaxiRoute);
	        this.removeRoutes = source["removeRoutes"];
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
	export class TaxiNetwork {
	    nodes: TaxiNode[];
	    routes: TaxiRoute[];
	    nextNode: number;
	    nextRoute: number;
	
	    static createFrom(source: any = {}) {
	        return new TaxiNetwork(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodes = this.convertValues(source["nodes"], TaxiNode);
	        this.routes = this.convertValues(source["routes"], TaxiRoute);
	        this.nextNode = source["nextNode"];
	        this.nextRoute = source["nextRoute"];
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
	
	
	
	
	export class TemplateRecord {
	    entry: number;
	    patch: number;
	    columns: TemplateColumn[];
	    values: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new TemplateRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.patch = source["patch"];
	        this.columns = this.convertValues(source["columns"], TemplateColumn);
	        this.values = source["values"];
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
	
	
	
	export class VendorItem {
	    item: number;
	    name: string;
	    quality: number;
	    displayId: number;
	    maxCount: number;
	    incrTime: number;
	    itemFlags: number;
	    condition: number;
	
	    static createFrom(source: any = {}) {
	        return new VendorItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.item = source["item"];
	        this.name = source["name"];
	        this.quality = source["quality"];
	        this.displayId = source["displayId"];
	        this.maxCount = source["maxCount"];
	        this.incrTime = source["incrTime"];
	        this.itemFlags = source["itemFlags"];
	        this.condition = source["condition"];
	    }
	}
	export class Vendor {
	    items: VendorItem[];
	    templateId: number;
	    template: VendorItem[];
	
	    static createFrom(source: any = {}) {
	        return new Vendor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], VendorItem);
	        this.templateId = source["templateId"];
	        this.template = this.convertValues(source["template"], VendorItem);
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
	
	export class VisualKit {
	    id: number;
	    effects: number[];
	
	    static createFrom(source: any = {}) {
	        return new VisualKit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.effects = source["effects"];
	    }
	}
	export class VisualDesign {
	    id: number;
	    stages: VisualKit[];
	    missile: number;
	    missileFrom: number;
	    area: number;
	    areaFrom: number;
	
	    static createFrom(source: any = {}) {
	        return new VisualDesign(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.stages = this.convertValues(source["stages"], VisualKit);
	        this.missile = source["missile"];
	        this.missileFrom = source["missileFrom"];
	        this.area = source["area"];
	        this.areaFrom = source["areaFrom"];
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
	export class VisualEffect {
	    id: number;
	    name: string;
	    model: string;
	
	    static createFrom(source: any = {}) {
	        return new VisualEffect(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.model = source["model"];
	    }
	}
	
	
	export class WeaponEntry {
	    entry: number;
	    name: string;
	    display: number;
	    invType: number;
	    quality: number;
	    class: number;
	    subclass: number;
	    model: string;
	    texture: string;
	
	    static createFrom(source: any = {}) {
	        return new WeaponEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entry = source["entry"];
	        this.name = source["name"];
	        this.display = source["display"];
	        this.invType = source["invType"];
	        this.quality = source["quality"];
	        this.class = source["class"];
	        this.subclass = source["subclass"];
	        this.model = source["model"];
	        this.texture = source["texture"];
	    }
	}
	export class WorldMapOverlay {
	    id: number;
	    areas: number[];
	    name: string;
	    width: number;
	    height: number;
	    offsetX: number;
	    offsetY: number;
	    hitTop: number;
	    hitLeft: number;
	    hitBottom: number;
	    hitRight: number;
	    pixels: number[];
	
	    static createFrom(source: any = {}) {
	        return new WorldMapOverlay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.areas = source["areas"];
	        this.name = source["name"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.offsetX = source["offsetX"];
	        this.offsetY = source["offsetY"];
	        this.hitTop = source["hitTop"];
	        this.hitLeft = source["hitLeft"];
	        this.hitBottom = source["hitBottom"];
	        this.hitRight = source["hitRight"];
	        this.pixels = source["pixels"];
	    }
	}
	export class WorldMapRow {
	    id: number;
	    mapId: number;
	    areaId: number;
	    name: string;
	    left: number;
	    right: number;
	    top: number;
	    bottom: number;
	
	    static createFrom(source: any = {}) {
	        return new WorldMapRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.mapId = source["mapId"];
	        this.areaId = source["areaId"];
	        this.name = source["name"];
	        this.left = source["left"];
	        this.right = source["right"];
	        this.top = source["top"];
	        this.bottom = source["bottom"];
	    }
	}
	export class WorldMapSpec {
	    row: WorldMapRow;
	    pixels: number[];
	    overlays: WorldMapOverlay[];
	
	    static createFrom(source: any = {}) {
	        return new WorldMapSpec(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.row = this.convertValues(source["row"], WorldMapRow);
	        this.pixels = source["pixels"];
	        this.overlays = this.convertValues(source["overlays"], WorldMapOverlay);
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
	export class WorldMapView {
	    row?: WorldMapRow;
	    pixels: number[];
	    overlays: WorldMapOverlay[];
	
	    static createFrom(source: any = {}) {
	        return new WorldMapView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.row = this.convertValues(source["row"], WorldMapRow);
	        this.pixels = source["pixels"];
	        this.overlays = this.convertValues(source["overlays"], WorldMapOverlay);
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
	export class ZoneSoundTables {
	    music: SoundOption[];
	    intro: SoundOption[];
	    ambience: SoundOption[];
	    prefs: SoundOption[];
	
	    static createFrom(source: any = {}) {
	        return new ZoneSoundTables(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.music = this.convertValues(source["music"], SoundOption);
	        this.intro = this.convertValues(source["intro"], SoundOption);
	        this.ambience = this.convertValues(source["ambience"], SoundOption);
	        this.prefs = this.convertValues(source["prefs"], SoundOption);
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
	export class ZoneWeather {
	    zone: number;
	    rain: number[];
	    snow: number[];
	    storm: number[];
	
	    static createFrom(source: any = {}) {
	        return new ZoneWeather(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.zone = source["zone"];
	        this.rain = source["rain"];
	        this.snow = source["snow"];
	        this.storm = source["storm"];
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

