function lerpAngle(a, b, t) {
    let delta = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    return a + delta * t;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function findBlockById(json, id) {
    const blocks = json.blocks?.blocks || [];
   
    const stack = [...blocks];

    while (stack.length) {
        const b = stack.pop();

        if (!b) continue;

        if (b.id === id) return b;

        // traverse inputs
        if (b.inputs) {
            for (const key in b.inputs) {
                const input = b.inputs[key];

                if (input?.block) {
                    stack.push(input.block);
                }
                if (input?.shadow) {
                    stack.push(input.shadow);
                }
            }
        }

        // next/child blocks (stack flow)
        if (b.next?.block) {
            stack.push(b.next.block);
        }
    }

    return null;
}

function lerpCFrame(a, b, t) {
    return {
        position: {
            x: a.position.x + (b.position.x - a.position.x) * t,
            y: a.position.y + (b.position.y - a.position.y) * t,
            z: a.position.z + (b.position.z - a.position.z) * t,
        },
        rotation: {
            x: lerpAngle(a.rotation.x, b.rotation.x, t),
            y: lerpAngle(a.rotation.y, b.rotation.y, t),
            z: lerpAngle(a.rotation.z, b.rotation.z, t),
        }
    };
}

      function make_color3(r = 255, g = 255, b = 255) {
        return { r, g, b };
      }

const topmostBLOCKS = [
    "event_start",
    "event_player_joined",
    "event_renderstep",
    "event_heartbeat",
    "event_keydown",
    "event_keyup",
    "event_m1d",
    "event_m1u",
    "event_m2d",
    "event_m2u",
    "recieve_from_client",
    "recieve_from_server",
    "event_scrollup",
    "event_scrolldown",
    "event_player_leave",

]


function FUNCTION_FOR_SCRIPT_INTERPRETER_MAIN(gameMODEL, source, context, ScriptName, SCRIPT_OBJ_ID, StartAtBlock, scriptingFrame) {
    let BlockRan = 0
    const activeLerps = {};
 let temppause = false

    function handleRuntimeError(err, context, ScriptName) {
       // if (context == "Server" ) {
           // console.log(err)
       // }
        COOLoutput(2, `Core Error: ${err}`, context, ScriptName)
    }

    console.log("Running script")

    let renderSteps = new Set();

   let last = performance.now();


    if (context == "Server") {
        async function engineLoop() {
            if (!temppause) {
                const now = Date.now();

                const dt = (now - last) / 1000;
                last = now;

                for (const fn of renderSteps) {
                    await fn(dt);
                }
            }


            setTimeout(engineLoop, 16); // ~60 FPS tick
        }

        engineLoop();
    } else {
        async function engineLoop(now) {
            

            const dt = (now - last) / 1000;
            last = now;

            for (const fn of renderSteps) {
                await fn(dt);
            }

        }

        window.rendersteps.push(engineLoop)
    }



    const TABLES = new Map();
    const GLOBAL_VARS = new Map();
    


    const parsed = JSON.parse(source);
    const GAME_MODEL_ID = "GAME_MODEL_ID"

    function isClientOnly() {
        return context === "Server";
    }

    function findFirstChild(obj, text) {
        let children = gameMODEL[obj]["children"]
        for (const i of children) {
            const cinfo = gameMODEL[i]
            if (!cinfo.props) {
                return false
            }
            const name = cinfo.props["Name"]
            if (name == text) {
                return i
            }
        }
        return false
    }

    function getFullName(obj) {
        let current = obj;
        const parts = [];

        while (current && gameMODEL[current]) {
            const name = gameMODEL[current].props?.Name || current;
            parts.push(name);

            current = gameMODEL[current].props?.Parent;
        }

        return parts.reverse().join(".");
    }

    function maketypeprintable(stuff) {
        if (stuff[0] == "Number") {
            return stuff[1]
        }
        if (stuff[0] == "String") {
            return stuff[1]
        }
        if (stuff[0] == "Bool") {
            return stuff[1]
        }
        if (stuff[0] == "Null") {
            return "null"
        }
        if (stuff[0] == "Object") {
            return getFullName(stuff[1])
        }
        if (stuff[0] == "Table") {
            return JSON.stringify(stuff[1])
        }
        if (stuff[0] == "Vector3") {
            return JSON.stringify(stuff[1])
        }
        if (stuff[0] == "Color3") {
            return JSON.stringify(stuff[1])
        }
        if (stuff[0] == "Vector2") {
            return JSON.stringify(stuff[1])
        }
        if (stuff[0] == "CFrame") {
            return JSON.stringify(stuff[1])
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    let evalCount = 0;
    let evalWindowStart = Date.now();

    const queue = [];
    let running = false;

    async function pushBlock(block, localvars) {
        //map is for local vars
        if (!localvars) {
            localvars = new Map()
        }
       // queue.push([block, localvars]);
       //runQueue()

       await evalBlock(block, localvars)
    }
    
    async function runQueue() {
        if (running) return;
        running = true;

        while (queue.length > 0) {
            const block = queue.shift();
            await evalBlock(block[0], block[1]);
        }

        running = false;
    }
    

    async function evalBlock(block, LOCAL_VARS) {

        const evalblockwithLOCALVARS = (b) => evalBlock(b, LOCAL_VARS);

        try {

            if (!block) return null;

            evalCount++;
            BlockRan ++;
            const now = Date.now();

            if (BlockRan > 100 && StartAtBlock) {
                COOLoutput(2, `Max test blocks ran (100)`, context, String(ScriptName) + " - " + String(BlockRan))
                return
            }

            const maxEVALS = 10000

            if (now - evalWindowStart >= maxEVALS) {
                console.log(evalCount, queue.length)
                evalWindowStart = now;
                evalCount = 0;
            }

            if (evalCount > maxEVALS && context == "Server") {
                temppause = true
                COOLoutput(2, `Server out of cpu! Throtting pausing for 5 seconds`, context, String(ScriptName) + " - " + String(BlockRan))
                await delay(5000)
                temppause = false
            }

            switch (block.type) {

                //Indexing


                case "index1": {
                    let obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    let text = (await evalblockwithLOCALVARS(block.inputs.TEXT.block))[1]

                    const foundOBJ = findFirstChild(obj, text)
                    if (!foundOBJ) {
                        COOLoutput(2, `${text} is not a valid member of ${getFullName(obj)}`, context, String(ScriptName) + " - " + String(BlockRan))
                    }


                    return ["Object", foundOBJ];
                }


                case "index2": {
                    let obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    let text1 = (await evalblockwithLOCALVARS(block.inputs.TEXT1.block))[1]
                    let text2 = (await evalblockwithLOCALVARS(block.inputs.TEXT2.block))[1]

                    const first = findFirstChild(obj, text1)
                    if (!first) {
                        COOLoutput(2, `${text1} is not a valid member of ${getFullName(obj)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }

                    const second = findFirstChild(first, text2)
                    if (!second) {
                        COOLoutput(2, `${text2} is not a valid member of ${getFullName(first)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }

                    return ["Object", second]
                }

                case "index3": {
                    let obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    let text1 = (await evalblockwithLOCALVARS(block.inputs.TEXT1.block))[1]
                    let text2 = (await evalblockwithLOCALVARS(block.inputs.TEXT2.block))[1]
                    let text3 = (await evalblockwithLOCALVARS(block.inputs.TEXT3.block))[1]

                    const first = findFirstChild(obj, text1)
                    if (!first) {
                        COOLoutput(2, `${text1} is not a valid member of ${getFullName(obj)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }

                    const second = findFirstChild(first, text2)
                    if (!second) {
                        COOLoutput(2, `${text2} is not a valid member of ${getFullName(first)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }

                    const third = findFirstChild(second, text3)
                    if (!third) {
                        COOLoutput(2, `${text3} is not a valid member of ${getFullName(second)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }

                    return ["Object", third]
                }

                case "index4": {
                    let obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    let text1 = (await evalblockwithLOCALVARS(block.inputs.TEXT1.block))[1]
                    let text2 = (await evalblockwithLOCALVARS(block.inputs.TEXT2.block))[1]
                    let text3 = (await evalblockwithLOCALVARS(block.inputs.TEXT3.block))[1]
                    let text4 = (await evalblockwithLOCALVARS(block.inputs.TEXT4.block))[1]

                    const first = findFirstChild(obj, text1)
                    if (!first) {
                        COOLoutput(2, `${text1} is not a valid member of ${getFullName(obj)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }

                    const second = findFirstChild(first, text2)
                    if (!second) {
                        COOLoutput(2, `${text2} is not a valid member of ${getFullName(first)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }

                    const third = findFirstChild(second, text3)
                    if (!third) {
                        COOLoutput(2, `${text3} is not a valid member of ${getFullName(second)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }


                    const forth = findFirstChild(third, text4)
                    if (!forth) {
                        COOLoutput(2, `${text4} is not a valid member of ${getFullName(third)}`, context, String(ScriptName) + " - " + String(BlockRan))
                        return ["Object", null]
                    }

                    return ["Object", forth]
                }


                case "prop_chain": {
                    let prop = (await evalblockwithLOCALVARS(block.inputs.PROP.block))[1]
                    let text = (await evalblockwithLOCALVARS(block.inputs.VALUE.block))[1]
                    const val = prop[text]
                    return ["Number", val];
                }

                case "clone": {
                    let OBJ2 = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    const newId = crypto.randomUUID()

                    const original = gameMODEL[OBJ2];
                    let clonedp = structuredClone(original.props)
                    clonedp["Parent"] = null

                    gameMODEL[newId] = {
                        props: clonedp,
                        children: [],
                    };


                    return ["Object", newId];
                }
                    

                case "index_game":
                    return ["Object", GAME_MODEL_ID];
                case "index_workspace":
                    return ["Object", findFirstChild(GAME_MODEL_ID, "Workspace")];
                case "index_camera":
                    return ["Object", findFirstChild(findFirstChild(GAME_MODEL_ID, "Workspace"), "Camera")];
                case "index_script":
                    return ["Object", SCRIPT_OBJ_ID];      
                    
                case "local_player": { //client only
                    return ["Object", window.LOCAL_PLAYER]
                }

                case "set_property":
                    let OBJ2 = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    let PROP2 = (await evalblockwithLOCALVARS(block.inputs.PROP.block))[1]
                    let VALUE2 = (await evalblockwithLOCALVARS(block.inputs.VALUE.block))[1]


                    if (PROP2 == "Parent") {
                      handle_parent_change(OBJ2, VALUE2)
                       
                    } else {
                        gameMODEL[OBJ2].props[PROP2] = VALUE2
                    }

                    if (context == "Client") {
                        window.UpdateOBJ_asrendered(OBJ2)
                    }

                    if (context == "Server") {
                        replicate_to_all(OBJ2)
                    }
 
                    

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                case "get_property":
                    let OBJ1 = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    let PROP1 = (await evalblockwithLOCALVARS(block.inputs.PROP.block))[1]

           
                    let VALUE = gameMODEL[OBJ1]["props"][PROP1]
                    if (VALUE && typeof VALUE === "object") {
                        VALUE = structuredClone(VALUE)
                    }

                    let type = prop_types[PROP1]

                    return [type, VALUE];

                case "get_children": {
                    let OBJ3 = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1];

                    let children = structuredClone(gameMODEL[OBJ3]["children"]);

                    const id = crypto.randomUUID();
                    const table = new Map();

                    TABLES.set(id, table);

                    // store children as indexed table
                    for (let i = 0; i < children.length; i++) {
                        table.set(i, children[i]);
                    }

                    return ["Table", id];
                }

                case "wait":
                    let secs = (await evalblockwithLOCALVARS(block.inputs.SECS.block))[1];
                    await sleep(secs * 1000)
                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;

                case "wait_for_child":
                    let obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    let text = (await evalblockwithLOCALVARS(block.inputs.TEXT.block))[1]

                    while (!findFirstChild(obj, text)) {
                        await sleep(16)
                    }

                    const foundOBJ = findFirstChild(obj, text)
 
                    return ["Object", foundOBJ];



                case "load_character": {
                    let userid = (await evalblockwithLOCALVARS(block.inputs.USERID.block))[1]
                    const newId = crypto.randomUUID()
                    let CHARNAME = "test"
                    const characterappear = await getCharacterApperance(userid)


                    console.log(characterappear)

                    gameMODEL[newId] = {
                        props: {
                            "Parent": null,
                            "ClassName": "Character",
                            "Name": CHARNAME,
                            "CFrame": {
                                "position": {
                                    "x": 0,
                                    "y": 5,
                                    "z": 0
                                },
                                "rotation": {
                                    "x": 0,
                                    "y": 0,
                                    "z": 0
                                }
                            },
                            "Scale": {
                                "x": 0.25,
                                "y": 0.25,
                                "z": 0.25
                            },
                            "Velocity": {
                                "x": 0,
                                "y": 0,
                                "z": 0
                            },
                            "Anchored": false,
                            "SourceURL": "/char.glb",
                            "HeadColor": characterappear["Head"],
                            "TorsoColor": characterappear["Torso"],
                            "LeftArmColor": characterappear["LeftArm"],
                            "RightArmColor": characterappear["RightArm"],
                            "LeftLegColor": characterappear["LeftLeg"],
                            "RightLegColor": characterappear["RightLeg"],
                            "NetworkOwner": null,
                        },
                        children: [],
                    };

                    return ["Object", newId];
                }

                case "applyimpulse": {
                    const obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    const vec3 = (await evalblockwithLOCALVARS(block.inputs.VEC3.block))[1]

                    const body = window.ID_TO_BODY[obj]
                    if (!body) {
                        return COOLoutput(2, `No Physics Body for ${obj}`, context, ScriptName);
                    }

                    body.applyImpulse(
                        vec3,
                        true
                    );

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "onfloor": {
                    const obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1]
                    const dist = (await evalblockwithLOCALVARS(block.inputs.DIST.block))[1]

                    const body = window.ID_TO_BODY[obj]
                    if (!body) {
                        return COOLoutput(2, `No Physics Body for ${obj}`, context, ScriptName);
                    }
                        
                    const isGrounded = Math.abs(body.linvel().y) < 0.01;

                    return ["Bool", isGrounded];
                }


                // --------------------
                // CORE TYPES
                // --------------------
                case "type_number":
                    return ["Number", block.fields?.TEXT];

                case "type_string":
                    return ["String", block.fields?.TEXT];

                case "type_false": {
                    return ["Bool", false];
                }
                case "type_true": {
                    return ["Bool", true];
                }

                case "type_null":
                    return ["Null", null];

                case "type_vector3": {
                    let v3 = make_vector3(
                        Number((await evalblockwithLOCALVARS(block.inputs.X.block))[1]),
                        Number((await evalblockwithLOCALVARS(block.inputs.Y.block))[1]),
                        Number((await evalblockwithLOCALVARS(block.inputs.Z.block))[1])
                    );
                    return ["Vector3", v3];
                }

                case "type_color3": {
                    let v3 = make_color3(
                        Number((await evalblockwithLOCALVARS(block.inputs.R.block))[1]),
                        Number((await evalblockwithLOCALVARS(block.inputs.G.block))[1]),
                        Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1])
                    );
                    return ["Color3", v3];
                }

                case "type_vector2": {
                    let v2 = make_vector2(
                        Number((await evalblockwithLOCALVARS(block.inputs.X.block))[1]),
                        Number((await evalblockwithLOCALVARS(block.inputs.Y.block))[1])
                    );
                    return ["Vector2", v2];
                }

                case "mag_vec3": {
                    const v = (await evalblockwithLOCALVARS(block.inputs.VEC.block))[1];

                    return ["Number", Math.sqrt(
                        v.x * v.x +
                        v.y * v.y +
                        v.z * v.z
                    )];
                }

                case "unit_vec3": {
                    const v = (await evalblockwithLOCALVARS(block.inputs.VEC.block))[1];

                    const mag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

                    if (mag > 0) {
                        return ["Vector3", make_vector3(
                            v.x / mag,
                            v.y / mag,
                            v.z / mag
                        )];
                    }

                    return ["Vector3", make_vector3(0, 0, 0)];
                }

                case "add_vector3": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.VEC1.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.VEC2.block))[1];

                    return ["Vector3", make_vector3(
                        a.x + b.x,
                        a.y + b.y,
                        a.z + b.z
                    )];
                }
                case "sub_vector3": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.VEC1.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.VEC2.block))[1];

                    return ["Vector3", make_vector3(
                        a.x - b.x,
                        a.y - b.y,
                        a.z - b.z
                    )];
                }
                case "mul_vector3": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.VEC1.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.VEC2.block))[1];

                    return ["Vector3", make_vector3(
                        a.x * b.x,
                        a.y * b.y,
                        a.z * b.z
                    )];
                }
                case "div_vector3": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.VEC1.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.VEC2.block))[1];

                    return ["Vector3", make_vector3(
                        a.x / b.x,
                        a.y / b.y,
                        a.z / b.z
                    )];
                }
                //cframe

                case "cframe_new": {
                    const x = Number((await evalblockwithLOCALVARS(block.inputs.X.block))[1]);
                    const y = Number((await evalblockwithLOCALVARS(block.inputs.Y.block))[1]);
                    const z = Number((await evalblockwithLOCALVARS(block.inputs.Z.block))[1]);

                    const rx = Number((await evalblockwithLOCALVARS(block.inputs.RX.block))[1]);
                    const ry = Number((await evalblockwithLOCALVARS(block.inputs.RY.block))[1]);
                    const rz = Number((await evalblockwithLOCALVARS(block.inputs.RZ.block))[1]);

                    return ["CFrame", make_cframe(x, y, z, rx, ry, rz)];
                }

                case "cframe_position": {
                    const v = (await evalblockwithLOCALVARS(block.inputs.VEC3.block))[1];

                    return ["CFrame", make_cframe(v.x, v.y, v.z, 0, 0, 0)];
                }

                case "cframe_position2": {
                    const pos = (await evalblockwithLOCALVARS(block.inputs.POS.block))[1];
                    const rot = (await evalblockwithLOCALVARS(block.inputs.ROT.block))[1];

                    return ["CFrame", make_cframe(
                        pos.x, pos.y, pos.z,
                        rot.x, rot.y, rot.z
                    )];
                }

                case "cframe_lookat": {
                    const pos = (await evalblockwithLOCALVARS(block.inputs.POS.block))[1];
                    const target = (await evalblockwithLOCALVARS(block.inputs.TARGET.block))[1];

                    const dx = target.x - pos.x;
                    const dy = target.y - pos.y;
                    const dz = target.z - pos.z;

                    // yaw (Y axis rotation)
                    const yaw = Math.atan2(-dx, -dz);

                    // pitch (X axis rotation)
                    const dist = Math.sqrt(dx * dx + dz * dz);
                    const pitch = Math.atan2(dy, dist);

                    return ["CFrame", make_cframe(
                        pos.x, pos.y, pos.z,
                        pitch, yaw, 0
                    )];
                }

                case "cframe_eanglesxyz": {
                    const rx = Number((await evalblockwithLOCALVARS(block.inputs.RX.block))[1]);
                    const ry = Number((await evalblockwithLOCALVARS(block.inputs.RY.block))[1]);
                    const rz = Number((await evalblockwithLOCALVARS(block.inputs.RZ.block))[1]);

                    return ["CFrame", make_cframe(0, 0, 0, rx, ry, rz)];
                }
                case "cframe_eanglesyxz": {
                    const rx = Number((await evalblockwithLOCALVARS(block.inputs.RX.block))[1]);
                    const ry = Number((await evalblockwithLOCALVARS(block.inputs.RY.block))[1]);
                    const rz = Number((await evalblockwithLOCALVARS(block.inputs.RZ.block))[1]);

                    return ["CFrame", make_cframe(0, 0, 0, rx, ry, rz)];
                }

                case "set_obj_cf": {
                    const obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1];
                    const cf = (await evalblockwithLOCALVARS(block.inputs.CF.block))[1];

                    gameMODEL[obj].props["CFrame"] = cf;

                    if (context == "Client") {
                        window.UpdateOBJ_asrendered(obj)
                    }

                    if (context == "Server") {
                        replicate_to_all(obj)
                    }

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "lerp_obj_cf": { //client only
                    const obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1];
                    const target = (await evalblockwithLOCALVARS(block.inputs.CF.block))[1];
                    const delta = (await evalblockwithLOCALVARS(block.inputs.DELTA.block))[1];

                    const model = gameMODEL[obj];
                    const start = model.props["CFrame"];

                    const startTime = performance.now();

                    function step() {
                        const now = performance.now();
                        const t = Math.min((now - startTime) / (delta * 1000), 1);

                        model.props["CFrame"] = lerpCFrame(start, target, t);

                        window.UpdateOBJ_asrendered(obj);
                        

                        if (t < 1) {
                            requestAnimationFrame(step);
                        }
                    }

                    step();

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }
                case "lerp_obj_cf_once": {
                    const obj = (await evalblockwithLOCALVARS(block.inputs.OBJ.block))[1];
                    const target = (await evalblockwithLOCALVARS(block.inputs.CF.block))[1];
                    const delta = (await evalblockwithLOCALVARS(block.inputs.DELTA.block))[1];

                    const model = gameMODEL[obj];

                    const current = model.props["CFrame"];

                    model.props["CFrame"] = lerpCFrame(current, target, delta);
                    
                    if (context == "Client") {
                        window.UpdateOBJ_asrendered(obj)
                    }

                    if (context == "Server") {
                        replicate_to_all(obj)
                    }

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "get_pos_cf": {
                    const cf = (await evalblockwithLOCALVARS(block.inputs.CF.block))[1];

                    return ["Vector3", make_vector3(
                        cf.position.x,
                        cf.position.y,
                        cf.position.z
                    )];
                }

                case "get_rot_cf": {
                    const cf = (await evalblockwithLOCALVARS(block.inputs.CF.block))[1];

                    return ["Vector3", make_vector3(
                        cf.rotation.x,
                        cf.rotation.y,
                        cf.rotation.z
                    )];
                }

                //CONNECTIONS!
                case "post_to_server": {
                    const NAME = (await evalblockwithLOCALVARS(block.inputs.NAME.block));
                    const DATA = (await evalblockwithLOCALVARS(block.inputs.DATA.block));

                    
                    window.post_to_server(NAME, DATA)
                    const next = block.next?.block;
                    if (next) {
                        await evalblockwithLOCALVARS(next)
                    }

                    return null;
                }

                case "post_to_client": {
                    const PLR = (await evalblockwithLOCALVARS(block.inputs.PLR.block))[1];
                    const NAME = (await evalblockwithLOCALVARS(block.inputs.NAME.block));
                    const DATA = (await evalblockwithLOCALVARS(block.inputs.DATA.block));

                    
                    post_to_client(PLR, NAME, DATA)
                    const next = block.next?.block;
                    if (next) {
                        await evalblockwithLOCALVARS(next)
                    }

                    return null;
                }

                

                case "post_to_all_clients": {
                    const NAME = (await evalblockwithLOCALVARS(block.inputs.NAME.block));
                    const DATA = (await evalblockwithLOCALVARS(block.inputs.DATA.block));

                    post_to_client_all_clients(NAME, DATA)
                    const next = block.next?.block;
                    if (next) {
                        await evalblockwithLOCALVARS(next)
                    }

                    return null;
                }

                case "recieve_from_server": {
                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (name, data) => {
                 
                        LOCAL_VARS.set("name", name);
                        LOCAL_VARS.set("data", data);

                        await evalblockwithLOCALVARS(next);
                    };

                    recieve_from_server.add(handler);
                    tell_server_im_ready()

                    return null;
                }

                case "recieve_from_client": {
                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (plr, name, data) => {
        
                        LOCAL_VARS.set("plr", plr);
                        LOCAL_VARS.set("name", name);
                        LOCAL_VARS.set("data", data);

                        await evalblockwithLOCALVARS(next);
                    };

                    recieve_from_client.add(handler);

                    return null;
                }


                //EVENTS

                case "event_start": {
                    const next = block.next?.block;

                    if (next) {
                        await evalblockwithLOCALVARS(next)
                    }

                    return null;
                }

                case "event_player_joined": { //only fires on server!
                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (player) => {
                        LOCAL_VARS.set("plr", player); //set plr local var
                        await evalblockwithLOCALVARS(next);
                    };

                    PLRJOINED.add(handler);

                    return null;
                }

                case "event_player_leave": { //only fires on server!
                    
                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (player) => {
                        LOCAL_VARS.set("plr", player); //set plr local var
                        await evalblockwithLOCALVARS(next);
                    };

                    PLRLEAVE.add(handler);

                    return null;
                }

                case "event_renderstep": {
                    const next = block.next?.block;
                    if (!next) return null;

                    const fn = async (dt) => {
                        LOCAL_VARS.set("dt", ["Number", dt]);
                        await pushBlock(next, LOCAL_VARS);
                    };

                    renderSteps.add(fn);

                    return null;
                }


                //add

                    case "oper_add": {
                        const A = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                        const B = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                        return ["Number", A + B];
                    }

                    case "oper_sub": {
                        const A = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                        const B = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                        return ["Number", A - B];
                    }

                    case "oper_mul": {
                        const A = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                        const B = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                        return ["Number", A * B];
                    }

                    case "oper_div": {
                        const A = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                        const B = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                        return ["Number", A / B];
                    }

                    case "oper_mod": {
                        const A = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                        const B = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                        return ["Number", A % B];
                    }
                case "oper_random": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);

                    const min = Math.min(a, b);
                    const max = Math.max(a, b);

                    const value = Math.random() * (max - min) + min;

                    return ["Number", value];
                }
                case "oper_lt": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.A.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.B.block))[1];
                    return ["Bool", Number(a) < Number(b)];
                }

                case "oper_gt": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.A.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.B.block))[1];
                    return ["Bool", Number(a) > Number(b)];
                }

                case "oper_equals": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.A.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.B.block))[1];

                    let equal;

                    // deep compare cframes/vector3/color3 and any objects
                    if (
                        a && b &&
                        typeof a === "object" &&
                        typeof b === "object"
                    ) {
                        equal = JSON.stringify(a) === JSON.stringify(b);
                    } else {
                        equal = a == b;
                    }
                    
                    return ["Bool", equal];
                }
                case "oper_and": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.A.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.B.block))[1];

                    return ["Bool", Boolean(a) && Boolean(b)];
                }
                case "oper_or": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.A.block))[1];
                    const b = (await evalblockwithLOCALVARS(block.inputs.B.block))[1];

                    return ["Bool", Boolean(a) || Boolean(b)];
                }
                case "oper_not": {
                    const a = (await evalblockwithLOCALVARS(block.inputs.A.block))[1];
                    return ["Bool", !Boolean(a)];
                }



                //strings

                case "string_join": {
                    return ["String", (await evalblockwithLOCALVARS(block.inputs.A.block))[1].toString() + ((await evalblockwithLOCALVARS(block.inputs.B.block))[1]).toString()];
                }
                case "string_letter": {
                    const index = Number((await evalblockwithLOCALVARS(block.inputs.INDEX.block))[1]);
                    const text = String((await evalblockwithLOCALVARS(block.inputs.TEXT.block))[1]);

                    // Blockly is usually 1-based indexing, so convert:
                    const char = text.charAt(index - 1);

                    return ["String", char];
                }
                case "string_len": {
                    return ["Number", String((await evalblockwithLOCALVARS(block.inputs.TEXT.block))[1]).length()];
                }
                //Advanced Math

                case "oper_floor": {
                    return ["Number", Math.floor(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_ceil": {
                    return ["Number", Math.ceil(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_round": {
                    return ["Number", Math.round(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_trunc": {
                    return ["Number", Math.trunc(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_abs": {
                    return ["Number", Math.abs(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_pow": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", Math.pow(a, b)];
                }
                case "oper_rad": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    return ["Number", a * (Math.PI / 180)];
                }

                case "oper_deg": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    return ["Number", a * (180 / Math.PI)];
                }

                case "oper_sqrt": {
                    return ["Number", Math.sqrt(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_exp": {
                    return ["Number", Math.exp(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_log": {
                    return ["Number", Math.log(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_log10": {
                    return ["Number", Math.log10(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_sin": {
                    return ["Number", Math.sin(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_cos": {
                    return ["Number", Math.cos(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_tan": {
                    return ["Number", Math.tan(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_asin": {
                    return ["Number", Math.asin(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_acos": {
                    return ["Number", Math.acos(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }

                case "oper_atan": {
                    return ["Number", Math.atan(Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]))];
                }
                case "oper_atan2": {
                    const y = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const x = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", Math.atan2(y, x)];
                }


                case "oper_min": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", Math.min(a, b)];
                }

                case "oper_max": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", Math.max(a, b)];
                }

                case "oper_clamp": {
                    const value = Number((await evalblockwithLOCALVARS(block.inputs.VALUE.block))[1]);
                    const min = Number((await evalblockwithLOCALVARS(block.inputs.MIN.block))[1]);
                    const max = Number((await evalblockwithLOCALVARS(block.inputs.MAX.block))[1]);

                    const clamped = Math.min(Math.max(value, min), max);

                    return ["Number", clamped];
                }
                //bitwise

                case "bit_and": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", a & b];
                }

                case "bit_or": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", a | b];
                }

                case "bit_xor": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", a ^ b];
                }
                case "bit_not": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    return ["Number", ~a];
                }
                case "bit_lshift": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", a << b];
                }

                case "bit_rshift": {
                    const a = Number((await evalblockwithLOCALVARS(block.inputs.A.block))[1]);
                    const b = Number((await evalblockwithLOCALVARS(block.inputs.B.block))[1]);
                    return ["Number", a >> b];
                }




                //console

                case "print": {
                    let basedata = await evalblockwithLOCALVARS(block.inputs.TEXT.block)

                    basedata = maketypeprintable(basedata)
                    COOLoutput(0, basedata, context, String(ScriptName) + " - " + String(BlockRan));
                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }
                case "warn": {
                    let basedata = await evalblockwithLOCALVARS(block.inputs.TEXT.block)
                    basedata = maketypeprintable(basedata)
                    COOLoutput(1, basedata, context, String(ScriptName) + " - " + String(BlockRan));
                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "error": {
                    let basedata = await evalblockwithLOCALVARS(block.inputs.TEXT.block)
                    basedata = maketypeprintable(basedata)
                    COOLoutput(2, basedata, context, String(ScriptName) + " - " + String(BlockRan));
                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                //tables
                case "table_create": {
                    const id = crypto.randomUUID();

                    TABLES.set(id, new Map());

                    return ["Table", id];
                }
                case "table_set": {
                    const tableId = (await evalblockwithLOCALVARS(block.inputs.TABLE.block))[1];
                    const key = (await evalblockwithLOCALVARS(block.inputs.KEY.block))[1];
                    const value = (await evalblockwithLOCALVARS(block.inputs.VALUE.block));

                    const table = TABLES.get(tableId);

                    if (table) {
                        table.set(key, value);
                    }



                    if (block.next && block.next.block) {
                        return (await evalblockwithLOCALVARS(block.next.block));
                    }

                    return null;
                }

                case "table_remove": {
                    const tableId = (await evalblockwithLOCALVARS(block.inputs.TABLE.block))[1];
                    const key = (await evalblockwithLOCALVARS(block.inputs.KEY.block))[1];

                    const table = TABLES.get(tableId);

                    if (!table) return ["Null", null];

                    table.delete(key);

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "table_len": {
                    const tableId = (await evalblockwithLOCALVARS(block.inputs.TABLE.block))[1];

                    const table = TABLES.get(tableId);

                    if (!table) return ["Number", 0];

                    return ["Number", table.size];
                }

                case "table_get": {
                    const tableId = (await evalblockwithLOCALVARS(block.inputs.TABLE.block))[1];
                    const key = (await evalblockwithLOCALVARS(block.inputs.KEY.block))[1];


                    const table = TABLES.get(tableId);


                    const value = table.get(key);


                    return value;
                }

                    case "table_tojson": {
                        const tableId = (await evalblockwithLOCALVARS(block.inputs.TABLE.block))[1];

                        const table = TABLES.get(tableId);
                        if (!table) return ["String", "[]"];

                        const obj = {};

                        for (const [key, value] of table.entries()) {
                            obj[key] = value;
                        }

                        return ["String", JSON.stringify(obj)];
                    }

                    case "json_to_table": {
                        const jsonStr = String((await evalblockwithLOCALVARS(block.inputs.JSON.block))[1] ?? "{}");

                        let parsed;
                        try {
                            parsed = JSON.parse(jsonStr);
                        } catch (err) {
                            COOLoutput(2, `Invalid JSON: ${err}`, context, ScriptName);
                            return ["Table", null];
                        }

                        const id = crypto.randomUUID();
                        const table = new Map();

                        for (const key in parsed) {
                            table.set(key, parsed[key]);
                        }

                        TABLES.set(id, table);

                        return ["Table", id];
                    }




                //Instances

                case "new_instance": {
                    const className = String((await evalblockwithLOCALVARS(block.inputs.ClassName.block))[1]);

                    const insid = window.createInstance({
                        Parent: null,
                        ClassName: className,
                        Name: className
                    })

                    return ["Object", insid];
                }

                //Control

                case "controls_if": {
                    const condition = (await evalblockwithLOCALVARS(block.inputs.IF0.block))[1];

                    if (condition) {
                        const next = block.inputs.DO0?.block;
                        if (next) await evalblockwithLOCALVARS(next);
                    } else {
                        const next = block.inputs.ELSE?.block;
                        if (next) await evalblockwithLOCALVARS(next);
                    }

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "controls_repeat_ext": {
                    const times = Number((await evalblockwithLOCALVARS(block.inputs.TIMES.block))[1]);

                    const body = block.inputs.DO?.block;

                    for (let i = 0; i < times; i++) {
                        if (body) await evalblockwithLOCALVARS(body);
                    }

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "controls_whileUntil": {
                    const mode = block.fields?.MODE; // "WHILE" or "UNTIL"
                    const conditionBlock = block.inputs.BOOL.block;
                    const body = block.inputs.DO?.block;

                    if (mode === "WHILE") {
                        while ((await evalblockwithLOCALVARS(conditionBlock))[1]) {
                            if (body) await evalblockwithLOCALVARS(body);
                        }
                    } else {
                        while (!(await evalblockwithLOCALVARS(conditionBlock))[1]) {
                            if (body) await evalblockwithLOCALVARS(body);
                        }
                    }

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                //globals
                case "var_set": {
                    const name = String(block.fields?.NAME ?? "");
                    let value = (await evalblockwithLOCALVARS(block.inputs.VALUE.block));
                    if (value && typeof value === "object") {
                        value = structuredClone(value)
                    }
                    GLOBAL_VARS.set(name, value);

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "var_change": {
                    const name = String(block.fields?.NAME ?? "");
                    const delta = Number((await evalblockwithLOCALVARS(block.inputs.DELTA.block))[1]);

                    const current = Number(GLOBAL_VARS.get(name)[1] ?? 0);

                    GLOBAL_VARS.set(name, ["Number", current + delta]);

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "var_get": {
                    const name = String(block.fields?.NAME ?? "");

                    const value = GLOBAL_VARS.has(name)
                        ? GLOBAL_VARS.get(name)
                        : ["Null", null];

                    return value;
                }

                //locals
                case "var_local_set": {
                    const name = String(block.fields?.NAME ?? "");
                    let value = (await evalblockwithLOCALVARS(block.inputs.VALUE.block));
                    if (value && typeof value === "object") {
                        value = structuredClone(value)
                    }
                    LOCAL_VARS.set(name, value);

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "var_local_change": {
                    const name = String(block.fields?.NAME ?? "");
                    const delta = Number((await evalblockwithLOCALVARS(block.inputs.DELTA.block))[1]);

                    const current = Number(LOCAL_VARS.get(name)[1] ?? 0);

                    LOCAL_VARS.set(name, ["Number", current + delta]);

                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
                }

                case "var_local_get": {
                    const name = String(block.fields?.NAME ?? "");
                   

                    const value = LOCAL_VARS.has(name)
                        ? LOCAL_VARS.get(name)
                        : ["Null", null];


                    return value;
                }


                //CLIENT ONLY BELOW

                case "is_key_down": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }
                    if (window.istyping()) {
                        return ["Bool", false];
                    }

                    const key = String((await evalblockwithLOCALVARS(block.inputs.KEY.block))[1]).toLowerCase();

                    const isDown = window.KEY_STATE.get(key) === true;

             

                    return ["Bool", isDown];
                }

                // Mouse X (relative to DISPLAY3dREAL)
                case "mouse_x": {
                    if (isClientOnly()) {
                        return ["Number", 0];
                    }
                    return ["Number", window.MOUSE_STATE?.x ?? 0];
                }

                // Mouse Y
                case "mouse_y": {
                    if (isClientOnly()) {
                        return ["Number", 0];
                    }
                    return ["Number", window.MOUSE_STATE?.y ?? 0];
                }

                case "mouse_x_delta": {
                    if (isClientOnly()) {
                        return ["Number", 0];
                    }
                    const dx = window.deltaX
                    

             
                    return ["Number", dx];
                }

                case "mouse_y_delta": {
                    if (isClientOnly()) {
                        return ["Number", 0];
                    }
                    const dy = window.deltaY
                    return ["Number", dy];
                }


                // Mouse 1 (left click)
                case "mouse_1_down": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }
                    const down = window.MOUSE_STATE?.buttons?.get(0) === true;
                    return ["Bool", down];
                }

                // Mouse 2 (right click)
                case "mouse_2_down": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }
                    const down = window.MOUSE_STATE?.buttons?.get(2) === true;
                    return ["Bool", down];
                }

     
        
                case "lockmouse": {
                    if (isClientOnly()) {
                        if (block.next && block.next.block) {
                            return await evalblockwithLOCALVARS(block.next.block);
                        }

                        return null;
                    }
                    document.body.requestPointerLock();


                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;
  
                }

    
                case "unlockmouse": {
                    if (isClientOnly()) {
                        if (block.next && block.next.block) {
                            return await evalblockwithLOCALVARS(block.next.block);
                        }

                        return null;
                    
                    }
                    document.exitPointerLock();


                    if (block.next && block.next.block) {
                        return await evalblockwithLOCALVARS(block.next.block);
                    }

                    return null;

                }

                case "unixtime": {
                    return ["Number", Date.now() / 1000];
                }


                case "event_keydown": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }
                    if (window.istyping()) {
                        return ["Bool", false];
                    }

                    const targetKEY = String((await evalblockwithLOCALVARS(block.inputs.KEY.block))[1]).toLowerCase();
                    const next = block.next?.block;

                    if (!next) return null;

                    const handler = async (e) => {
                        if (e.key.toLowerCase() === targetKEY) {
                            await evalblockwithLOCALVARS(next);
                        }
                    };

                    window.addEventListener("keydown", handler);

                    return null;
                }



                case "event_keyup": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }
                    const targetKEY = String(await evalblockwithLOCALVARS(block.inputs.KEY.block)?.[1] ?? "").toLowerCase();
                    const next = block.next?.block;

                    if (!next) return null;

                    const handler = async (e) => {
                        if (e.key.toLowerCase() === targetKEY) {
                            await evalblockwithLOCALVARS(next);
                        }
                    };

                    window.addEventListener("keyup", handler);

                    return null;
                }


                case "event_m1d": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }
                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (e) => {
                        if (e.button === 0) { // 0 = left mouse button (M1)
                            await evalblockwithLOCALVARS(next);
                        }
                    };

                    window.addEventListener("mousedown", handler);

                    return null;
                }


                case "event_m1u": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }
                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (e) => {
                        if (e.button === 0) { // 0 = left mouse button (M1)
                            await evalblockwithLOCALVARS(next);
                        }
                    };

                    window.addEventListener("mouseup", handler);

                    return null;
                }

                case "event_m2d": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }

                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (e) => {
                        if (e.button === 2) {
                            await evalblockwithLOCALVARS(next);
                        }
                    };

                    window.addEventListener("mousedown", handler);

                    return null;
                }

                case "event_m2u": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }

                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (e) => {
                        if (e.button === 2) {
                            await evalblockwithLOCALVARS(next);
                        }
                    };

                    window.addEventListener("mouseup", handler);

                    return null;
                }

                case "event_scrollup": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }

                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (e) => {
                        if (e.deltaY < 0) {
                            await evalblockwithLOCALVARS(next);
                        }
                    };

                    window.addEventListener("wheel", handler);

                    return null;
                }

                case "event_scrolldown": {
                    if (isClientOnly()) {
                        return ["Bool", false];
                    }

                    const next = block.next?.block;
                    if (!next) return null;

                    const handler = async (e) => {
                        if (e.deltaY > 0) {
                            await evalblockwithLOCALVARS(next);
                        }
                    };

                    window.addEventListener("wheel", handler);

                    return null;
                }



                default:
                    console.warn("Unknown block:", block.type);
                    return null;
            }

        } catch (err) {
            handleRuntimeError(err, context, String(ScriptName) + " - " + String(BlockRan))
        }
    }

    const topBlocks = parsed.blocks.blocks;


    if (StartAtBlock) {
        console.log(StartAtBlock)
        const BLOCK = findBlockById(parsed, StartAtBlock)

        console.log(BLOCK)


        evalBlock(BLOCK, new Map())
            .then((response) => {
                
                if (response) {
                    COOLoutput(0, "Response: " + String(maketypeprintable(response)), "", "");
                }
                

                
            });
    } else {
        for (const b of topBlocks) {
            if (topmostBLOCKS.includes(b.type)) {
                pushBlock(b);
            }
    }
    }






}

try {
    window.testrun = FUNCTION_FOR_SCRIPT_INTERPRETER_MAIN
} catch {
    console.log("client")
}
