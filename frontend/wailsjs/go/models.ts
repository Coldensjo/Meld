export namespace mapfile {
	
	export class PlacedObject {
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
	    heights: string;
	    splatA: string;
	    splatB: string;
	
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
	        this.heights = source["heights"];
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

