const WebSocket = require("ws");
const http = require("http");
const zlib = require("zlib");
const { readFile } = require("fs").promises;
const vm = require("vm")
const { performance } = require("perf_hooks");
const crypto = require("crypto")
const { filterText } = require("./filtertext")

let emptyTimeout = null;
const EMPTY_GRACE_MS = 30000;

let JOB_ID = null;

let GAMEMODEL = null;
let PLAYERS = []
let plrINS2plr = {}
let GAME_MODEL_ID = "GAME_MODEL_ID"

//for plr join event
let PLRJOINED = new Set()
let PLRLEAVE = new Set()

let recieve_from_client = new Set()

//post to server
let ONSERVEREVENT = new Set()

function firePlayerJoined(plrINSTANCE) {
  for (const fn of PLRJOINED) {
    fn(["Object", plrINSTANCE]);
  }
}

function firePlayerLeave(plrINSTANCE) {
  for (const fn of PLRLEAVE) {
    fn(["Object", plrINSTANCE]);
  }
}

function fireRECIVEFROMCLIENT(plr, name, data) {
  for (const fn of recieve_from_client) {
    fn(["Object", plr], name, data);
  }
}

function waitForGameModel() {
  return new Promise((resolve) => {
    const check = () => {
      if (GAMEMODEL != null) {
        resolve(GAMEMODEL);
      } else {
        setTimeout(check, 10); // check every 10ms
      }
    };
    check();
  });
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader.split(";").filter(Boolean).map(c => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    })
  );
}

function generatefuncid() {
  return "VEX_" + Math.random().toString(36).slice(2, 10);
}

function filter_msg(msg) {
  const fixed = filterText(msg)
  return fixed
}


async function replication_tick(OBJ, Player) {
  const ws = Player["ws"]
  const replicated = Player["replicated"]
  console.warn("REP", OBJ)

  const objectdata = GAMEMODEL[OBJ]
  ws.send(JSON.stringify({
    type: "replicateins",
    data: { objectdata, OBJ },
  }))
}

async function replicate_to_all(OBJ) {
  for (const i of PLAYERS) {
    await replication_tick(OBJ, i)
  }
}

function handle_parent_change(OBJECT, PARENT) {
  const oldParent = GAMEMODEL[OBJECT].props["Parent"];

  // Remove from old parent's children
  if (oldParent && GAMEMODEL[oldParent]) {
    const siblings = GAMEMODEL[oldParent].children;
    const index = siblings.indexOf(OBJECT);
    if (index !== -1) {
      siblings.splice(index, 1);
    }
  }

  // Set new parent
  GAMEMODEL[OBJECT].props["Parent"] = PARENT;

  // Add to new parent's children
  if (PARENT && GAMEMODEL[PARENT]) {
    GAMEMODEL[PARENT].children.push(OBJECT);
  }

  replicate_to_all(OBJECT)
  replicate_to_all(PARENT)
}

function waitForClientReady(realplr) {
  return new Promise((resolve) => {
    const check = () => {
      if (realplr.ready_for_events) {
        resolve();
      } else {
        setTimeout(check, 10); // retry every 10ms
      }
    };
    check();
  });
}

async function post_to_client(plr, name, data) {
  console.log(plrINS2plr, plr)
  const realplr = plrINS2plr[plr]
  const ws = realplr["ws"]

  await waitForClientReady(realplr)

  ws.send(JSON.stringify({
    type: "client_post",
    data: { name, data }
  }));
}

async function post_to_client_all_clients(name, data) {
  const promises = Object.keys(plrINS2plr).map(async (i) => {
    const realplr = plrINS2plr[i];
    if (!realplr || !realplr.ws) return;

    await waitForClientReady(realplr);

    realplr.ws.send(JSON.stringify({
      type: "client_post",
      data: { name, data }
    }));
  });

  await Promise.all(promises);
}

function low_level_post_all_clients(str) {
  for (const i of Object.keys(plrINS2plr)) {
    const realplr = plrINS2plr[i];
    if (!realplr || !realplr.ws) continue;

    realplr.ws.send(str);
  }
}


function make_vector3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function make_vector2(x = 0, y = 0) {
  return { x, y };
}

function make_color3(r = 255, g = 255, b = 255) {
  return { r, g, b };
}

function make_cframe(
  px = 0, py = 0, pz = 0,
  rx = 0, ry = 0, rz = 0
) {
  return {
    position: { x: px, y: py, z: pz },
    rotation: { x: rx, y: ry, z: rz }
  };
}

let all_props_for_classes = null
let prop_types = null
let core_setup = false

async function setup_core() {
  const dirname = __dirname
  all_props_for_classes = await readFile(dirname + "/public/all_props_for_classes.json", "utf-8");
  all_props_for_classes = JSON.parse(all_props_for_classes)

  prop_types = await readFile(dirname + "/public/prop_types.json", "utf-8");
  prop_types = JSON.parse(prop_types)

  core_setup = true
}

function createInstance(props) {
  const instanceID = crypto.randomUUID()
  const parentID = props["Parent"]

  if (parentID) {
    GAMEMODEL[parentID]["children"].push(instanceID)
  }

  for (const i of all_props_for_classes[props.ClassName]) {
    if (props[i] == undefined) {
      const pt = prop_types[i]
      if (pt == "String") {
        if ((i) == "Source") {
          props[i] = Source_DEFAULT
        } else {
          props[i] = ""
        }
      } else if (pt == "Number") {
        props[i] = 0
      } else if (pt == "Object") {
        props[i] = null
      } else if (pt == "Vector3") {
        props[i] = make_vector3()
      } else if (pt == "Color3") {
        props[i] = make_color3()
      } else if (pt == "Vector2") {
        props[i] = make_vector2()
      } else if (pt == "Bool") {
        props[i] = true
      } else if (pt == "CFrame") {
        props[i] = make_cframe()
      }
    }
  }

  GAMEMODEL[instanceID] = {
    children: [],
    props: props,
  }
  replicate_to_all(parentID)
  replicate_to_all(instanceID)

  return instanceID
}

function delete_instance(INSTANCE) {


  function memorydel() {
    delete GAMEMODEL[INSTANCE]

    for (const Player of PLAYERS) {
      const ws = Player["ws"]
      const replicated = Player["replicated"]

      ws.send(JSON.stringify({
        type: "deleteins",
        data: { "OBJ": INSTANCE },
      }))
    }

    console.warn("FULLY DELETED ", INSTANCE)
  }

  if (GAMEMODEL[INSTANCE]) {
    handle_parent_change(INSTANCE, null)
      setTimeout(() => {
        memorydel();
    }, 5000);
  }


}

function findFirstChild(obj, text) {
  let children = GAMEMODEL[obj]["children"]
  for (const i of children) {
    const cinfo = GAMEMODEL[i]
    const name = cinfo.props["Name"]
    if (name == text) {
      return i
    }
  }
  return false
}

function findFirstChildOfClass(obj, Class) {
  let children = GAMEMODEL[obj]["children"]
  for (const i of children) {
    const cinfo = GAMEMODEL[i]
    const name = cinfo.props["ClassName"]
    if (name == Class) {
      return i
    }
  }
  return false
}

async function getPlayerFromSession(sessionId) {
  console.log("sesh", sessionId)
  const res = await fetch(`http://localhost:3000/api/session/${sessionId}`);
  console.log(res.status)
  if (!res.ok) return null;
  return await res.json(); // { name, id, etc }
}

async function getCharacterApperance(USERID) {
  const res = await fetch(`http://localhost:3000/api/avatar/${USERID}`);
  if (!res.ok) return null;
  return await res.json();
}




function startServer(PORT_TO_USE) {
  const clientcanaccess = [
    "Workspace",
    "Players",
    "ReplicatedStorage",
    "Lighting",
    "ClientScripts",
  ]


function isDescendantOfReplicatedInstance(obj) {
    for (const i of clientcanaccess) {
        const workspaceID = findFirstChildOfClass("GAME_MODEL_ID", i)
        let current = obj;

        while (current) {
          if (current === workspaceID) return true;
          current = GAMEMODEL[current].props.Parent;
        }
    }

    return false;
  }



  const server = http.createServer();

  const wss = new WebSocket.Server({ noServer: true });




  function checkShutdown() {
    if (PLAYERS.length > 0) {
      if (emptyTimeout) {
        clearTimeout(emptyTimeout);
        emptyTimeout = null;
      }
      return;
    }

    if (emptyTimeout) return;

    console.log("No players. Starting shutdown timer...");

    emptyTimeout = setTimeout(() => {
      if (PLAYERS.length === 0) {
        console.log("No players for 5. Shutting down process.");

        process.exit(0);
      }

      emptyTimeout = null;
    }, EMPTY_GRACE_MS);
  }

  setInterval(() => {
      checkShutdown()
  }, 10000);



  // Handle upgrade so we can read URL path
  server.on("upgrade", async  (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    console.log(url)
    
    const jobid = url.searchParams.get("jobid");

    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies.sessionId;

    console.log(sessionId)

    const PlayerInfo = await getPlayerFromSession(sessionId)
    console.log(PlayerInfo)

    if (!PlayerInfo) {
      socket.destroy();
      return;  
    }

    // reject invalid job
    if (!jobid || jobid !== JOB_ID) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.jobid = jobid;
      ws.sessionId = sessionId;
      ws.playerInfo = PlayerInfo;
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    console.log("Client connected to job:", ws.sessionId);
    const MYSESSIONCOOKIE = ws.sessionId
    const plrinfo = ws.playerInfo

  

    let MYPLAYER;
    let plrI;

    ws.send(JSON.stringify({
      type: "welcome",
      data: { "msg": "connected" }
    }));

    ws.on("message", (data) => {
      let dataPARSE = JSON.parse(data)

      const type = dataPARSE['type']
      const sentdata = dataPARSE['data']

      if (type == "join") {
        const plr = {
          ws,
          replicated: {},
          plrINSTANCE: null,
          ready_for_events: false
        }
        MYPLAYER = plr
        PLAYERS.push(plr)


        for (const objid of Object.keys(GAMEMODEL)) {
          if (isDescendantOfReplicatedInstance(objid)) {
            replication_tick(objid, plr)
          }
        }

        const playersinstance = findFirstChild(GAME_MODEL_ID, "Players")

        plrI = createInstance({
          ClassName: "Player",
          Name: plrinfo["username"],
          UserId: plrinfo["id"],
          Parent: playersinstance
        })

        plrINS2plr[plrI] = plr

        ws.send(JSON.stringify({
          type: "local_player",
          data: { plrI }
        }));

        plr["plrINSTANCE"] = plrI
        firePlayerJoined(plrI) //fire plr join
      }

      if (type == "reqobj") {


        let objid = sentdata["OBJ_ID"]
        if (!objid) {
          return
        }
        if (!GAMEMODEL[objid]) {
          return
        }

        //incase client gueses a uuid or knows it
        if (isDescendantOfReplicatedInstance(objid)) {
          replication_tick(objid, MYPLAYER)
        }
        

      }

      if (type == "ping") {
        ws.send(JSON.stringify({
          type: "pong",
          data: {}
        }));
      }

      if (type == "server_post") {
        fireRECIVEFROMCLIENT(plrI, sentdata["name"], sentdata["data"])
      }

       if (type == "ready_for_client_events") {
        MYPLAYER["ready_for_events"] = true
          }

       if (type == "send_chat") {
          const msg = sentdata["msg"]

          const filtered_msg = filter_msg(msg)

          low_level_post_all_clients(JSON.stringify({
            type: "chat_recv",
            data: { plrI, filtered_msg }
          }))
        }

        if (type == "typing") {
          const state = sentdata["state"]
          
          low_level_post_all_clients(JSON.stringify({
            type: state ? "typing_recv" : "typing_stop",
            data: { plrI }
          }));

        }

    });

    ws.on("close", () => {
      delete plrINS2plr[plrI]
      PLAYERS = PLAYERS.filter(p => p.ws !== ws);
      firePlayerLeave(plrI) //fire plr leave

      delete_instance(plrI)
      

      console.log("Client disconnected");
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
  });

  server.listen(PORT_TO_USE, () => {
    console.log(`WS running on ws://localhost:${PORT_TO_USE}/${JOB_ID}`);
  });
}

process.on("message", async (msg) => {
  if (msg.type === "job") {
    JOB_ID = String(msg.jobid);
    console.log("Job ID set:", JOB_ID);
  }

  if (msg.type === "init") {
    const port = msg.port;
    await setup_core()

    console.log("Starting server on port:", port);

    await waitForGameModel()

    startServer(port);
  }
});

function decompress(vexlbuffer) {
  return new Promise((resolve, reject) => {
    zlib.gunzip(vexlbuffer, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}


function COOLoutput(type, text, Context = "", ScriptName = "") {
  console.log(type, text, Context, ScriptName)

  for (const Player of PLAYERS) {
    const ws = Player["ws"]

    ws.send(JSON.stringify({
      type: "server_output",
      data: { type, text, Context, ScriptName }
    }));
  }

}

let running_scripts = 0

async function build_world(vexlbuffer) {
  const decomped = await decompress(vexlbuffer)
  GAMEMODEL = JSON.parse(String(decomped)); //MAIN DEFINE

  for (const insID of Object.keys(GAMEMODEL)) { //replicate to all
    for (const plr of PLAYERS) {
      replication_tick(insID, plr)
    }
    //server scripts

    const objectData = GAMEMODEL[insID]
    const props = objectData["props"]
    const ClassName = props["ClassName"]
    const name = props["Name"]
    let parentClass = props["Parent"]
    if (parentClass) {
      parentClass = GAMEMODEL[parentClass]
      if (parentClass) {
        parentClass = parentClass["props"]
        parentClass = parentClass["ClassName"]
      }


    }
    
    if (ClassName == "ServerScript" && props["Enabled"] == true) {
      running_scripts += 1

      if (running_scripts > 5) {
        COOLoutput(2, `Excedding Max server scripts limit (5). ${name} will not run.`, "Core Server", "")
        continue
      }


      let clonedRAW = await readFile(__dirname + "/public/script_interpreter.js", "utf-8")
      const thisscriptid = generatefuncid()
      clonedRAW = clonedRAW.replace("FUNCTION_FOR_SCRIPT_INTERPRETER_MAIN", thisscriptid)
      clonedRAW += `\nglobal.${thisscriptid} = ${thisscriptid};`;
      const source = props["Source"]

      const context = {
        COOLoutput,
        GAMEMODEL,
        PLAYERS,
        global,
        performance,
        Date,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        PLRJOINED,
        PLRLEAVE,
        console,
        crypto,
        structuredClone,
        handle_parent_change,
        prop_types,
        post_to_client,
        recieve_from_client,
        post_to_client_all_clients,
        replicate_to_all,
        getCharacterApperance,
      };
      vm.createContext(context);
      vm.runInContext(clonedRAW, context);
      setTimeout(async () => {
        global[thisscriptid](GAMEMODEL, source, "Server", name, insID);
      }, 0);
    }


  }

}

const chunks = [];

process.stdin.on("data", (chunk) => {
  chunks.push(chunk);
});

function waitForCoreSetup() {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (core_setup) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

process.stdin.on("end", async () => {
  const vexlbuffer = Buffer.concat(chunks);

  console.log("Received VEXL buffer size:", vexlbuffer.length);


  await waitForCoreSetup()
  build_world(vexlbuffer)

});