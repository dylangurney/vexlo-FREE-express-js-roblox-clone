window.KEY_STATE = new Map();

window.addEventListener("keydown", (e) => {
  window.KEY_STATE.set(e.key.toLowerCase(), true);
});

window.addEventListener("keyup", (e) => {
  window.KEY_STATE.set(e.key.toLowerCase(), false);
});

window.MOUSE_STATE = {
  buttons: new Map(), // left/middle/right
  x: 0,
  y: 0,
  down: false
};
const display = document.getElementById("DISPLAY3dREAL") || document.getElementById("display3darea");
// mouse move (position)

window.deltaX = 0
window.deltaY = 0

setInterval(() => { //idk if this is smooth
    window.deltaX = 0
    window.deltaY = 0
}, 1);
//FOR DELTA
document.addEventListener("mousemove", (e) => {
  window.deltaX += e.movementX;
  window.deltaY += e.movementY;
});


display.addEventListener("mousemove", (e) => {
  //reset on frame remember to do that

  const rect = display.getBoundingClientRect();

  window.MOUSE_STATE.x = e.clientX - rect.left;
  window.MOUSE_STATE.y = e.clientY - rect.top;
});

// mouse down
window.addEventListener("mousedown", (e) => {
  window.MOUSE_STATE.down = true;
  window.MOUSE_STATE.buttons.set(e.button, true);
});

// mouse up
window.addEventListener("mouseup", (e) => {
  window.MOUSE_STATE.buttons.set(e.button, false);

  // check if ANY button still pressed
  window.MOUSE_STATE.down = [...window.MOUSE_STATE.buttons.values()].some(v => v);
});

let recieve_from_server = new Set()

function fireRecieveFromServer(name, data) {
  for (const fn of recieve_from_server) {
    fn(name, data);
  }
}

let script_code_raw_client = ""

async function fetchraw() {
  const s1 = await fetch("/script_interpreter.js")
  const s2 = await s1.text()
  script_code_raw_client = s2
  console.log("Vexlo client installed")
}



function generatefuncid() {
  return "VEX_" + Math.random().toString(36).slice(2, 10);
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}



function RUN_LOCAL_SCRIPT(source, SCRIPT_OBJ_ID) {

  const scriptEl = document.createElement("script");
  let clonedRAW = script_code_raw_client + ""
  const thisscriptid = generatefuncid()
  clonedRAW = clonedRAW.replace("FUNCTION_FOR_SCRIPT_INTERPRETER_MAIN", thisscriptid)

  clonedRAW += `\nwindow.${thisscriptid} = ${thisscriptid};`;

  const blob = new Blob([clonedRAW], { type: "application/javascript" });
  const blobURL = URL.createObjectURL(blob);

  scriptEl.src = blobURL

  document.body.appendChild(scriptEl);
  
  // run script logic
  scriptEl.onload = () => {

    (async () => {
      await window[thisscriptid](GAMEMODEL, source, "Client", name, SCRIPT_OBJ_ID);
    })();

  }

}

async function run_client_core() {
  console.log("RUN!")
  await fetchraw()
  const jobid = window.SERVER_JOB_ID;
  const pendingRequests = new Map();

  if (!jobid) {
    console.error("Missing SERVER_JOB_ID");
    return;
  }
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  const protocol = location.protocol === "https:" ? "wss" : "ws";

  const wsUrl = isLocal
    ? `ws://localhost:3000/gameserver?port=${window.SERVER_PORT}&jobid=${jobid}`
    : `wss://${location.hostname}/gameserver?port=${window.SERVER_PORT}&jobid=${jobid}`;
    
  console.warn(wsUrl)
  const ws = new WebSocket(wsUrl);




  ws.onopen = () => {
    console.log("Connected to VEXL server:", jobid);

    ws.send(JSON.stringify({
      type: "join",
      data: {},
    }));


    setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      ws.send(JSON.stringify({
        type: "ping",
        data: {}
      }));
    }, 10000);

  };

  ws.onmessage = (event) => {

    const msg = JSON.parse(event.data);
    const msgDATA = msg["data"]

    if (msg["type"] == "replicateins") {
      const objectData = msg["data"]["objectdata"]
      const insID = msg["data"]["OBJ"]
      window.GAMEMODEL[insID] = objectData

      const resolver = pendingRequests.get(insID);
      if (resolver) {
        console.warn("yay obj req back!")
        resolver(true);


        pendingRequests.delete(insID);
      }

      const props = objectData["props"]
      const ClassName = props["ClassName"]
      const children = objectData["children"]
      const ParentID = props["Parent"]
      let Parent = GAMEMODEL[ParentID]
      let parentClass;

      if (Parent) {
          let parprops = Parent["props"]
          if (parprops) {
            parentClass = parprops["ClassName"]
          }
          if (!Parent.children.includes(insID)) {
            Parent.children.push(insID);
          }
      }



      if (ClassName == "Part" || ClassName == "SpawnLocation") {
        let rendered = window.ID_TO_MESH[insID]
        add_part_for_render(props, insID, children, rendered)
      }
      if (ClassName == "Mesh" || ClassName == "Character") {
        let rendered = window.ID_TO_MESH[insID]
        add_MESHpart_for_render(props, insID, children, rendered)
      }
      if (ClassName == "Image") {
        let rendered = window.ID_TO_MESH[insID]
          add_decal_for_render(props, insID, rendered)
      }
      if (ClassName == "ClientScript" && parentClass == "ClientScripts") {
        const source = props["Source"]
        RUN_LOCAL_SCRIPT(source, insID)
      }
      if (ClassName == "Player") {
        addPlayer(insID, "data?")
      }
      
    }

    if (msg["type"] == "deleteins") {
      const insID = msg["data"]["OBJ"]
      const objectData = window.GAMEMODEL[insID]
      const props = objectData["props"]
      const ClassName = props["ClassName"]

      

      if (ClassName == "Player") {
        removePlayer(insID, "data?")
      }
      handle_delete_obj(insID, false)
    }



    if (msg["type"] === "denyreqobj") {
      const insID = msg["data"]["objectdata"]

      const resolver = pendingRequests.get(insID);
      if (resolver) {
        resolver(false);


        pendingRequests.delete(insID);
      }
    }

    if (msg["type"] === "server_output") {
      const stuff = msg["data"]

      window.COOLoutput(stuff["type"], stuff["text"], stuff["Context"], stuff["ScriptName"])
    }

    if (msg["type"] == "client_post") {
      const stuff = msg["data"]
      fireRecieveFromServer(stuff["name"], stuff["data"])
    }

    if (msg["type"] == "local_player") {
      const stuff = msg["data"]
      window.LOCAL_PLAYER = stuff["plrI"]
    }

    if (msg["type"] == "chat_recv") {
      
      const msgcontent = msgDATA["filtered_msg"]
      const THATP = msgDATA["plrI"]
      window.addChatMessage(THATP, msgcontent)
    }

    if (msg["type"] == "welcome") {
      document.getElementById("loadingscreen").style.display = "none"
    }
    
  };

  function post_to_server(name, data) {
      ws.send(JSON.stringify({
        type: "server_post",
        data: { name, data }
      }));
  }
  window.post_to_server = post_to_server

  function tell_server_im_ready() {
      ws.send(JSON.stringify({
        type: "ready_for_client_events",
        data: {}
      })); 
  }
  window.tell_server_im_ready = tell_server_im_ready 

  function REQUEST_INSTANCE_REPLICATION_AND_WAIT(OBJ_ID) {
    return new Promise((resolve) => {

      pendingRequests.set(OBJ_ID, resolve);

      ws.send(JSON.stringify({
        type: "reqobj",
        data: { OBJ_ID }
      }));
    });
  }

  window.REQUEST_INSTANCE_REPLICATION_AND_WAIT = REQUEST_INSTANCE_REPLICATION_AND_WAIT

  ws.onclose = () => {
    console.log("Disconnected from server");
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    alert("Connection Error", err)
  };

  window.VEXL_WS = ws;


}


run_client_core()

