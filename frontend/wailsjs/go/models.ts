export namespace config {
	
	export class Project {
	    name: string;
	    path: string;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	    }
	}

}

export namespace main {
	
	export class WorldHintData {
	    id: number;
	    colour: number;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new WorldHintData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.colour = source["colour"];
	        this.name = source["name"];
	    }
	}
	export class ItemSpritesResult {
	    images: Record<number, string>;
	    hints: WorldHintData[];
	    summary: string;
	
	    static createFrom(source: any = {}) {
	        return new ItemSpritesResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.images = source["images"];
	        this.hints = this.convertValues(source["hints"], WorldHintData);
	        this.summary = source["summary"];
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
	export class SpriteFile {
	    path: string;
	    name: string;
	    id: number;
	    width: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new SpriteFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.id = source["id"];
	        this.width = source["width"];
	        this.height = source["height"];
	    }
	}
	export class SpriteModel {
	    path: string;
	    name: string;
	    sprite: string;
	    glb: string;
	    sides: string;
	    summary: string;
	    width: number;
	    height: number;
	    voxels: number;
	    extra: number;
	    covered: number;
	    triangles: number;
	    size: number[];
	    bytes: number;
	    reading: string;
	    run: string;
	    centreX: number;
	    centreY: number;
	    scores: spritemodel.Score[];
	    frames: number;
	
	    static createFrom(source: any = {}) {
	        return new SpriteModel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.sprite = source["sprite"];
	        this.glb = source["glb"];
	        this.sides = source["sides"];
	        this.summary = source["summary"];
	        this.width = source["width"];
	        this.height = source["height"];
	        this.voxels = source["voxels"];
	        this.extra = source["extra"];
	        this.covered = source["covered"];
	        this.triangles = source["triangles"];
	        this.size = source["size"];
	        this.bytes = source["bytes"];
	        this.reading = source["reading"];
	        this.run = source["run"];
	        this.centreX = source["centreX"];
	        this.centreY = source["centreY"];
	        this.scores = this.convertValues(source["scores"], spritemodel.Score);
	        this.frames = source["frames"];
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
	export class SpriteModelOptions {
	    projection: string;
	    reading: string;
	    keepOutline: boolean;
	    scale: number;
	    centre: boolean;
	    centreX: number;
	    centreY: number;
	    frame: number;
	
	    static createFrom(source: any = {}) {
	        return new SpriteModelOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projection = source["projection"];
	        this.reading = source["reading"];
	        this.keepOutline = source["keepOutline"];
	        this.scale = source["scale"];
	        this.centre = source["centre"];
	        this.centreX = source["centreX"];
	        this.centreY = source["centreY"];
	        this.frame = source["frame"];
	    }
	}
	export class TibiaImport {
	    path: string;
	    summary: string;
	
	    static createFrom(source: any = {}) {
	        return new TibiaImport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.summary = source["summary"];
	    }
	}
	export class WorldChunkData {
	    cx: number;
	    cz: number;
	    layer: number;
	    cubes: string;
	    paint: string;
	    blend: string;
	    overlay: string;
	
	    static createFrom(source: any = {}) {
	        return new WorldChunkData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cx = source["cx"];
	        this.cz = source["cz"];
	        this.layer = source["layer"];
	        this.cubes = source["cubes"];
	        this.paint = source["paint"];
	        this.blend = source["blend"];
	        this.overlay = source["overlay"];
	    }
	}
	export class WorldRecordData {
	    tag: number;
	    flags: number;
	    body: string;
	
	    static createFrom(source: any = {}) {
	        return new WorldRecordData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tag = source["tag"];
	        this.flags = source["flags"];
	        this.body = source["body"];
	    }
	}
	export class WorldObjectData {
	    id: number;
	    kind: number;
	    face: number;
	    pos: WorldSpawnData;
	    targets: number[];
	    state: number;
	    colour: number;
	
	    static createFrom(source: any = {}) {
	        return new WorldObjectData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.face = source["face"];
	        this.pos = this.convertValues(source["pos"], WorldSpawnData);
	        this.targets = source["targets"];
	        this.state = source["state"];
	        this.colour = source["colour"];
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
	export class WorldJoinData {
	    id: number;
	    cubes: WorldSpawnData[];
	
	    static createFrom(source: any = {}) {
	        return new WorldJoinData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.cubes = this.convertValues(source["cubes"], WorldSpawnData);
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
	export class WorldImageData {
	    id: number;
	    png: string;
	
	    static createFrom(source: any = {}) {
	        return new WorldImageData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.png = source["png"];
	    }
	}
	export class WorldMoodData {
	    mood: string;
	    min: WorldSpawnData;
	    max: WorldSpawnData;
	
	    static createFrom(source: any = {}) {
	        return new WorldMoodData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mood = source["mood"];
	        this.min = this.convertValues(source["min"], WorldSpawnData);
	        this.max = this.convertValues(source["max"], WorldSpawnData);
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
	export class WorldPropData {
	    model: string;
	    x: number;
	    y: number;
	    z: number;
	    turn: number;
	    scale: number;
	
	    static createFrom(source: any = {}) {
	        return new WorldPropData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model = source["model"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.turn = source["turn"];
	        this.scale = source["scale"];
	    }
	}
	export class WorldNpcData {
	    name: string;
	    pos: WorldSpawnData;
	    route: WorldSpawnData[];
	
	    static createFrom(source: any = {}) {
	        return new WorldNpcData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.pos = this.convertValues(source["pos"], WorldSpawnData);
	        this.route = this.convertValues(source["route"], WorldSpawnData);
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
	export class WorldMonsterData {
	    kind: string;
	    pos: WorldSpawnData;
	
	    static createFrom(source: any = {}) {
	        return new WorldMonsterData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.pos = this.convertValues(source["pos"], WorldSpawnData);
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
	export class WorldSpawnData {
	    x: number;
	    z: number;
	    layer: number;
	
	    static createFrom(source: any = {}) {
	        return new WorldSpawnData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.z = source["z"];
	        this.layer = source["layer"];
	    }
	}
	export class WorldData {
	    chunksX: number;
	    chunksZ: number;
	    chunks: WorldChunkData[];
	    spawn?: WorldSpawnData;
	    monsters: WorldMonsterData[];
	    npcs: WorldNpcData[];
	    props: WorldPropData[];
	    moods: WorldMoodData[];
	    hints: WorldHintData[];
	    images: WorldImageData[];
	    joins: WorldJoinData[];
	    objects: WorldObjectData[];
	    kept: WorldRecordData[];
	
	    static createFrom(source: any = {}) {
	        return new WorldData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chunksX = source["chunksX"];
	        this.chunksZ = source["chunksZ"];
	        this.chunks = this.convertValues(source["chunks"], WorldChunkData);
	        this.spawn = this.convertValues(source["spawn"], WorldSpawnData);
	        this.monsters = this.convertValues(source["monsters"], WorldMonsterData);
	        this.npcs = this.convertValues(source["npcs"], WorldNpcData);
	        this.props = this.convertValues(source["props"], WorldPropData);
	        this.moods = this.convertValues(source["moods"], WorldMoodData);
	        this.hints = this.convertValues(source["hints"], WorldHintData);
	        this.images = this.convertValues(source["images"], WorldImageData);
	        this.joins = this.convertValues(source["joins"], WorldJoinData);
	        this.objects = this.convertValues(source["objects"], WorldObjectData);
	        this.kept = this.convertValues(source["kept"], WorldRecordData);
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

export namespace play {
	
	export class Spot {
	    X: number;
	    Y: number;
	    Z: number;
	    Yaw: number;
	    Pitch: number;
	
	    static createFrom(source: any = {}) {
	        return new Spot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.X = source["X"];
	        this.Y = source["Y"];
	        this.Z = source["Z"];
	        this.Yaw = source["Yaw"];
	        this.Pitch = source["Pitch"];
	    }
	}

}

export namespace recovery {
	
	export class Info {
	    id: string;
	    session: string;
	    name: string;
	    file: string;
	    world: boolean;
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
	        this.world = source["world"];
	        this.saved = source["saved"];
	        this.fileTime = source["fileTime"];
	    }
	}

}

export namespace spritemodel {
	
	export class Score {
	    reading: string;
	    covered: number;
	
	    static createFrom(source: any = {}) {
	        return new Score(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.reading = source["reading"];
	        this.covered = source["covered"];
	    }
	}

}

