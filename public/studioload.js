    const STUD_TO_METER = 0.28;
window.rendersteps = []

class CFrame {
  constructor(position = {x:0,y:0,z:0}, euler = {x:0,y:0,z:0}) {
    this.position = position;
    this.euler = euler;

    this.updateMatrix();
  }

  updateMatrix() {
    const x = THREE.MathUtils.degToRad(this.euler.x);
    const y = THREE.MathUtils.degToRad(this.euler.y);
    const z = THREE.MathUtils.degToRad(this.euler.z);

    const euler = new THREE.Euler(x, y, z, "YXZ");
    const quat = new THREE.Quaternion().setFromEuler(euler);

    this.matrix = new THREE.Matrix4();
    this.matrix.compose(
      new THREE.Vector3(
        this.position.x * STUD_TO_METER,
        this.position.y * STUD_TO_METER,
        this.position.z * STUD_TO_METER
      ),
      quat,
      new THREE.Vector3(1, 1, 1)
    );
  }

  setPosition(pos) {
    this.position = pos;
    this.updateMatrix();
  }

  setRotation(rot) {
    this.euler = rot;
    this.updateMatrix();
  }
}  
      
      
      async function load_3dstuff(params) {
          window.scene = new THREE.Scene();
          const STUD_TO_METER = 0.28;

         openState = {}
         selectedNode = null


            
        window.UpdateOBJ_asrendered = UpdateOBJ_asrendered

        for (const id of Object.keys(GAMEMODEL)) { //update to latest properties
          const objectData = GAMEMODEL[id]
          const props = objectData["props"]
          const classname = props["ClassName"]
          const propsfor = window.all_props_for_classes[classname]
          for (const i of propsfor) {
            if (props[i] === undefined) {
              const defaultPROP = window.prop_default[i]
              const pt = prop_types[i]
              if (pt == "String") {
                if ((i) == "Source") {
                  props[i] = Source_DEFAULT
                } else {
                  props[i] = ""
                }
              } else if (pt == "Number") {
                props[i] = defaultPROP || 0
              } else if (pt == "Object") {
                props[i] = defaultPROP || null
              } else if (pt == "Vector3") {
                props[i] = defaultPROP || make_vector3()
              } else if (pt == "Color3") {
                props[i] = defaultPROP || make_color3()
              } else if (pt == "Vector2") {
                props[i] = defaultPROP || make_vector2()
              } else if (pt == "Bool") {
                props[i] = defaultPROP || true
              } else if (pt == "CFrame") {
                props[i] = defaultPROP || make_cframe()
              }

              

            }
            
          }

        }


        

        //render game model
        for (const id of Object.keys(GAMEMODEL)) {
          const objectData = GAMEMODEL[id]
          const props = objectData["props"]
          const ClassName = props["ClassName"]
          const children = objectData["children"]
          if (ClassName == "Part" || ClassName == "SpawnLocation") {
            add_part_for_render(props, id, children)
          }
          if (ClassName == "Mesh" || ClassName == "Character") {
            add_MESHpart_for_render(props, id, children)
          }
        }
        //2nd render everything after meshes are done

        for (const id of Object.keys(GAMEMODEL)) {
          const objectData = GAMEMODEL[id]
          const props = objectData["props"]
          const ClassName = props["ClassName"]
          if (ClassName == "Image") {
            add_decal_for_render(props, id)
          }

        }


      update_explorer()

      console.log(GAMEMODEL)

      const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
      );



      camera.position.set(0, 20, 40);

      camera.lookAt(0, 0, 0);

      const loader = new EXRLoader();

      loader.load('/sky.exr', function (texture) {
        texture.mapping = THREE.EquirectangularReflectionMapping;

        window.scene.background = texture;
        window.scene.environment = texture;
      });

      const renderer = new THREE.WebGLRenderer({ antialias: true });

      // IMPORTANT: use container size, not window size
      const container = document.getElementById("DISPLAY3dREAL");
      renderer.setSize(container.clientWidth, container.clientHeight);

      const stats = new Stats();
      container.appendChild(stats.dom);
      stats.dom.style.position = "absolute"
      stats.dom.style.right = "0px"
      stats.dom.style.left = ""
      
      container.appendChild(renderer.domElement);


      const gametab = createTAB("Game", "/doc.svg", renderer.domElement, true, "maingame")

      openTAB(gametab)

function loadTextureByExtension(url, texLoader, exrLoader) {
  const ext = url.split('.').pop().toLowerCase();

  if (ext === "exr") {
    return exrLoader.loadAsync(url);
  }

  // default image formats
  return texLoader.loadAsync
    ? texLoader.loadAsync(url)
    : new Promise((resolve, reject) => {
        texLoader.load(url, resolve, undefined, reject);
      });
}

      async function loadMaterial(tx) {

        const key = tx.ColorURL;

        if (window.materialCache[key]) {
          return window.materialCache[key].clone();
        }

        const texLoader = new THREE.TextureLoader();
        const exrLoader = new EXRLoader();

        const colorMap = await loadTextureByExtension(tx.ColorURL, texLoader, exrLoader);
        const normalMap = await loadTextureByExtension(tx.NormalURL, texLoader, exrLoader);
        const roughnessMap = await loadTextureByExtension(tx.RoughnessURL, texLoader, exrLoader);
        const displacementMap = await loadTextureByExtension(tx.DisplacementURL, texLoader, exrLoader);

        const tiling = tx.Tiling ?? { x: 50, y: 50 };

        const allMaps = [colorMap, normalMap, roughnessMap, displacementMap];

        for (const t of allMaps) {
          if (!t) continue;

          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = THREE.RepeatWrapping;

          t.generateMipmaps = true;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.magFilter = THREE.LinearFilter;

          t.anisotropy = 16;

          // 👇 SAME SCALE FOR EVERYTHING
          t.repeat.set(tiling.x, tiling.y);
        }

        const material = new THREE.MeshStandardMaterial({
          map: colorMap,
          normalMap,
          roughnessMap,
          displacementMap,
          displacementScale: 0.2,
          metalness: 0
        });



        window.materialCache[key] = material;
        return material;
      }



    async function add_part_for_render(PART, id, children, rendered) {
      if (!isDescendantOfWorkspace(id)) {
        const existing = window.ID_TO_MESH[id];
        if (existing) {
          scene.remove(existing);
          delete window.ID_TO_MESH[id];
        }
        return
      };

      const existing = window.ID_TO_MESH[id];

      const size = PART.Size;
      const col = PART.Color;

      let tex = false;

      for (const cid of children) {
        const objd = GAMEMODEL[cid];
        if (objd.props["ClassName"] === "Texture") {
          tex = objd.props;
        }
      }

      const pcolor = new THREE.Color(col.r / 255, col.g / 255, col.b / 255);

      const cf = PART.CFrame;
      const cframe = new CFrame(
        cf.position,
        cf.rotation || cf.euler || { x: 0, y: 0, z: 0 }
      );

      // 🔥 IF ALREADY EXISTS → UPDATE ONLY
      if (rendered && existing) {
        existing.matrix.copy(cframe.matrix);

        if (existing.geometry) {
          existing.geometry.dispose();

          existing.geometry = new THREE.BoxGeometry(
            size.x * STUD_TO_METER,
            size.y * STUD_TO_METER,
            size.z * STUD_TO_METER
          );
        }

        if (existing.material) {
          if (tex) {
            loadMaterial(tex).then((mat) => {
              mat.color.set(pcolor);
              existing.material = mat;
            });
          } else {
const applyMaterialUpdate = (mat) => {
  if (!mat) return;

  if (mat.color) mat.color.set(pcolor);

  const repeatX = (size.x * STUD_TO_METER) * 3.6;
  const repeatZ = (size.z * STUD_TO_METER) * 3.6;

  const maps = [
    mat.map,
    mat.normalMap,
    mat.displacementMap,
    mat.roughnessMap,
    mat.aoMap,
    mat.specularMap
  ];

  for (const tex of maps) {
    if (!tex) continue;

    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatZ);
    tex.needsUpdate = true;
  }
};
if (Array.isArray(existing.material)) {
  existing.material.forEach(applyMaterialUpdate);
} else {
  applyMaterialUpdate(existing.material);
}
          }
        }

        return;
      }

      // 🔥 CREATE NEW
      const geometry = new THREE.BoxGeometry(
        size.x * STUD_TO_METER,
        size.y * STUD_TO_METER,
        size.z * STUD_TO_METER
      );

      let topMat;
      let sidematerial;

      if (tex) {
        topMat = await loadMaterial(tex);
        topMat.color.set(pcolor);
        sidematerial = topMat
      } else {

        const loader = new THREE.TextureLoader();

const fix = (t) => {
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};

const normal = fix(loader.load("/textures/stud_normal.png"));
const displacement = fix(loader.load("/textures/stud_displacement.png"));

const repeatX = (size.x * STUD_TO_METER)*3.6
const repeatZ = (size.z * STUD_TO_METER)*3.6

normal.repeat.set(repeatX, repeatZ);
displacement.repeat.set(repeatX, repeatZ);

topMat = new THREE.MeshStandardMaterial({
  color: pcolor,

  normalMap: normal,
  normalScale: new THREE.Vector2(0.8, 0.8),


  roughness: 0.7,
  metalness: 0.1
});


        sidematerial = new THREE.MeshStandardMaterial({
          color: pcolor,
          roughness: 0.7,
          metalness: 0.1
        });


      }

const materials = [
  sidematerial, // right
  sidematerial, // left
  topMat,  // top ← STUDS HERE
  sidematerial, // bottom
  sidematerial, // front
  sidematerial  // back
];

      const mesh = new THREE.Mesh(geometry, materials);

      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(cframe.matrix);

      window.ID_TO_MESH[id] = mesh;
      window.scene.add(mesh);
    }
function applyCharacterColors(character, PART) {
  const colorMap = {
    Head: PART.HeadColor,
    Torso: PART.TorsoColor,
    LeftArm: PART.LeftArmColor,
    RightArm: PART.RightArmColor,
    LeftLeg: PART.LeftLegColor,
    RightLeg: PART.RightLegColor,
  };

  character.traverse((obj) => {
    if (!obj.isMesh) return;

    const col = colorMap[obj.name]; //hex code
    if (!col) return;

    obj.material = obj.material.clone();
    obj.material.color.set(col);
  });
}

    async function add_MESHpart_for_render(PART, id, children, rendered) {
      if (!isDescendantOfWorkspace(id)) {
        const existing = window.ID_TO_MESH[id];
        if (existing) {
          scene.remove(existing);
          delete window.ID_TO_MESH[id];
        }
        return
      };
      const classname = PART.ClassName

      

      let sourceurl = PART.SourceURL;
      const scale = PART.Scale
      if (!sourceurl) {
         if (classname == "Character") {
            sourceurl = "/char.glb"
         } else {
          return
         }
        
      }

      const cf = PART.CFrame;
      const cframe = new CFrame(
        cf.position,
        cf.rotation || { x: 0, y: 0, z: 0 }
      );

      const existing = window.ID_TO_MESH[id];

      // 🔥 IF ALREADY RENDERED → JUST UPDATE
      if (rendered && existing) {
        existing.position.set(
          cframe.position.x*STUD_TO_METER,
          cframe.position.y*STUD_TO_METER,
          cframe.position.z*STUD_TO_METER
        );

        existing.rotation.set(
          cframe.euler.x*STUD_TO_METER,
          cframe.euler.y*STUD_TO_METER,
          cframe.euler.z*STUD_TO_METER
        );

        existing.scale.set(scale.x, scale.y, scale.z);
        if (classname == "Character") {
          applyCharacterColors(existing, PART)
        }
        existing.updateMatrix();
        return;
      }

      // 🔥 OTHERWISE CREATE NEW
      const GLBloader = new GLTFLoader();

      GLBloader.load(sourceurl, (gltf) => {
        const character = gltf.scene;

        character.traverse((obj) => {
          if (obj.isMesh && obj.material) {
            obj.material.depthWrite = true;
            obj.material.depthTest = true;
          }
        });

        character.position.set(
          cframe.position.x,
          cframe.position.y,
          cframe.position.z
        );

        character.rotation.set(
          cframe.euler.x,
          cframe.euler.y,
          cframe.euler.z
        );

        character.scale.set(scale.x, scale.y, scale.z);

        character.updateMatrix();
        character.matrixAutoUpdate = false;
        if (classname == "Character") {
          applyCharacterColors(character, PART)
        }
        window.ID_TO_MESH[id] = character;
        scene.add(character);
      });
    }

      function add_decal_for_render(DECAL, id) {
        if (!isDescendantOfWorkspace(id)) {
          const existing = window.ID_TO_MESH[id];
          if (existing) {
            scene.remove(existing);
            delete window.ID_TO_MESH[id];
            delete window.DECAL_FOR_PART_ID[parID]
          }
          return
        };

        const parID = DECAL.Parent
        if (!parID) {
          return
        }
        const targetMesh = window.ID_TO_MESH[parID]
        if (!targetMesh) {
          return
        }

        targetMesh.updateMatrixWorld(true);
        const loader = new THREE.TextureLoader();
        const texture = loader.load(DECAL.ImageURL);

        texture.transparent = true;

        const faces = {
          Top: new THREE.Vector3(0, 1, 0),
          Bottom: new THREE.Vector3(0, -1, 0),
          Front: new THREE.Vector3(0, 0, 1),
          Back: new THREE.Vector3(0, 0, -1),
          Left: new THREE.Vector3(-1, 0, 0),
          Right: new THREE.Vector3(1, 0, 0),
        };

        const normal = faces[DECAL.Face].clone().normalize();;

        const position = new THREE.Vector3();
        targetMesh.getWorldPosition(position);
        position.add(normal.clone().multiplyScalar(0.6));

        const up = new THREE.Vector3(0, 0, 1); // decal forward axis

        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          up,
          normal
        );
        const orientation = new THREE.Euler().setFromQuaternion(quaternion);

        const size = new THREE.Vector3(
          DECAL.ImageSize.x * STUD_TO_METER,
          DECAL.ImageSize.y * STUD_TO_METER,
          1,
        );

        const decalGeometry = new DecalGeometry(
          targetMesh,
          position,
          orientation,
          size
        );

        // material
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
        });

        const decalMesh = new THREE.Mesh(decalGeometry, material);

       window.ID_TO_MESH[id] = decalMesh

        if (!window.DECAL_FOR_PART_ID[parID]) {
          window.DECAL_FOR_PART_ID[parID] = []
        }

        window.DECAL_FOR_PART_ID[parID].push({ decalMesh, id })

        window.scene.add(decalMesh);
      }



      document.addEventListener("mousedown", (e) => {
        if (!obj_prop_changing) return;

        const clickedInside = e.target.closest(".nodeselect");

        if (!clickedInside) {
          document.body.classList.remove("pickmode");
          obj_prop_changing = false;

          // re-enable all object buttons
          document.querySelectorAll(".propvalueobjectbtn").forEach(btn => {
            btn.disabled = false;
          });
        }
      });




      document.addEventListener("mousedown", (e) => {
        if (e.button != 0) {
          return
        }
        console.log(selectedNode)
        if (!selectedNode) return;

        const clickedInside = e.target.closest(".canvas");

        if (clickedInside) {
          selectedNode.dom.classList.remove("selected")
          update_properties_tab()
        }
      });



   


    function isDescendantOfWorkspace(obj) {
        const workspaceID = findFirstChild(window.GAME_MODEL_ID, "Workspace")
      let current = obj;
      console.log(GAMEMODEL[current])

      while (current) {
        if (current === workspaceID) return true;
        current = GAMEMODEL[current].props.Parent;
      }


      return false;
    }

      function UpdateOBJ_asrendered(id) {
        let rendered = window.ID_TO_MESH[id]

        const objectData = GAMEMODEL[id]
        const props = objectData["props"]
        const ClassName = props["ClassName"]
        const children = objectData["children"]

        if (ClassName == "Part" || ClassName == "SpawnLocation") {

       
          add_part_for_render(props, id, children, rendered)
          

         
          if (window.DECAL_FOR_PART_ID[id]) {

            const list = [...window.DECAL_FOR_PART_ID[id]]; // clone array
            window.DECAL_FOR_PART_ID[id] = []

            for (const INFO of list) {
              const decalid = INFO.id;
              //UpdateOBJ_asrendered(decalid);

              let rendered = window.ID_TO_MESH[decalid]
              if (rendered) {
                window.scene.remove(rendered);

                if (rendered.geometry) rendered.geometry.dispose();
                if (rendered.material) {
                  if (rendered.material.map) rendered.material.map.dispose();
                  rendered.material.dispose();
                }
                delete window.ID_TO_MESH[decalid];
              }
              add_decal_for_render(GAMEMODEL[decalid].props, decalid, rendered)
              
            
            }

          }
          
        } else if (ClassName == "Mesh" || ClassName == "Character") {
          add_MESHpart_for_render(props, id, children, rendered)
          
        } else if (ClassName == "Image") {
          add_decal_for_render(props, id, rendered)
          // UpdateOBJ_asrendered(props.Parent)
        } else if (ClassName == "Texture") {
          UpdateOBJ_asrendered(props.Parent, rendered)
        }


      }









   





      function updatecam() {
        const width = container.clientWidth;
        const height = container.clientHeight;

        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }

      // handle resize
      window.addEventListener("resize", () => {
        updatecam()
      });




      const keys = {};
      let isRightMouseDown = false;

      let yaw = 0;
      let pitch = 0;

      const moveSpeed = 0.1;
      const lookSpeed = 0.002;

      // track keys
      window.addEventListener("keydown", (e) => keys[e.code] = true);
      window.addEventListener("keyup", (e) => keys[e.code] = false);

      let isLocked = false;

      document.addEventListener("pointerlockchange", () => {
        if (window.PLAYTESTING) {
          return
        }
        if (renderer.domElement.style.display == "none") {
          return
        }

        isLocked = document.pointerLockElement === container;
      });

      // right mouse look
      container.addEventListener("mousedown", (e) => {
        if (window.PLAYTESTING) {
          return
        }
        if (renderer.domElement.style.display == "none") {
          return
        }

        if (e.button === 2) {
          container.requestPointerLock();
        }
      });
      window.addEventListener("mouseup", (e) => {
        if (window.PLAYTESTING) {
          return
        }

        if (e.button === 2) {
          document.exitPointerLock();
        }
      });
      // prevent context menu (important)
      container.addEventListener("contextmenu", (e) => {
        if (renderer.domElement.style.display != "none") {
          e.preventDefault()
        }


      });

      // mouse move = look around
      window.addEventListener("mousemove", (e) => {
        if (window.PLAYTESTING) {
          return
        }
        if (renderer.domElement.style.display == "none") {
          return
        }

        if (!isLocked) return;

        yaw -= e.movementX * lookSpeed;
        pitch -= e.movementY * lookSpeed;


        const MAX_LOOK_UP = Math.PI / 2 - 0.1;   // ~89°
        const MAX_LOOK_DOWN = -Math.PI / 2 + 0.1; // ~-89°

        pitch = Math.max(MAX_LOOK_DOWN, Math.min(MAX_LOOK_UP, pitch));
      });

      const zoomSpeed = 0.05;

      // scroll = zoom
      window.addEventListener("wheel", (e) => {
        if (window.PLAYTESTING) {
          return
        }
        if (renderer.domElement.style.display == "none") {
          return
        }

        camera.position.addScaledVector(
          getForwardVector(),
          e.deltaY * (-zoomSpeed)
        );
      });

      // helper: forward direction
      function getForwardVector() {
        const v = new THREE.Vector3(0, 0, -1);
        v.applyEuler(camera.rotation);
        return v;
      }
      function updateCameraRotation() {

        const direction = new THREE.Vector3();

        direction.x = Math.cos(pitch) * Math.sin(yaw);
        direction.y = Math.sin(pitch);
        direction.z = Math.cos(pitch) * Math.cos(yaw);

        const lookTarget = camera.position.clone().add(direction);

        camera.up.set(0, 1, 0);
        camera.lookAt(lookTarget);
      }
      function updateCamera() {

        // apply rotation

        const forward = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
        const right = new THREE.Vector3(1, 0, 0).applyEuler(camera.rotation);

        if (keys["KeyW"]) camera.position.addScaledVector(forward, moveSpeed);
        if (keys["KeyS"]) camera.position.addScaledVector(forward, -moveSpeed);
        if (keys["KeyD"]) camera.position.addScaledVector(right, moveSpeed);
        if (keys["KeyA"]) camera.position.addScaledVector(right, -moveSpeed);


        const pos = camera.position;
        const rot = camera.rotation;


      }

    function findFirstChild(obj, text) {
        let children = GAMEMODEL[obj]["children"]
        for (const i of children) {
            const cinfo = GAMEMODEL[i]
            const name = cinfo.props["Name"]
            return i
        }
        return false
    }




      document.addEventListener("keydown", (e) => {
        if (e.target.classList.contains("propvalue") && e.key === "Enter") {
          e.target.blur();
        }
        if (selectedNode && e.key === "Delete") {
          window.handle_delete_obj(selectedNode.id)
        }

      });

      const popup = document.getElementById("insertPopup");
      const search = document.getElementById("insertSearch");
      const closeBtn = document.getElementById("closeInsert");

      function openInsertPopup() {
        popup.classList.remove("hidden");
        search.value = "";
        search.focus();

        const container = document.getElementById("objectList");
        container.innerHTML = ""; // clear old items

        Object.keys(all_props_for_classes).forEach(type => {
          if (CLASS_Services.includes(type)) {
            return
          }


          let html = `<div class="nodeselect obj-item">


      <img class="iconimage whiteimg" src="/exicons/${type}.svg">

      <span>${type}</span>

      </div>`

          let created = document.createElement("div")
          created.innerHTML = html

          created.querySelector(".obj-item").dataset.type = type

          created.onclick = () => {
            console.log("Insert:", type);

            const madeid = createInstance({
              Parent: findFirstChild(window.GAME_MODEL_ID, "Workspace"),
              ClassName: type,
              Name: type,
            })
            update_explorer()
            UpdateOBJ_asrendered(madeid)


            closeInsertPopup();
          };

          container.appendChild(created);
        });
      }

      function closeInsertPopup() {
        popup.classList.add("hidden");
      }

      document.getElementById("insertObject").onclick = function () {
        openInsertPopup()
      }

      // close button
      closeBtn.onclick = closeInsertPopup;

      // click object to insert
      document.querySelectorAll(".obj-item").forEach(item => {
        item.onclick = () => {
          const type = item.dataset.type;

          console.log("Insert:", type);

          // example hook into your engine:
          // createObject(type)

          closeInsertPopup();
        };
      });

      // simple search filter
      search.addEventListener("input", () => {
        const q = search.value.toLowerCase();

        document.querySelectorAll(".obj-item").forEach(item => {
          const match = item.dataset.type.toLowerCase().includes(q);
          item.style.display = match ? "block" : "none";
        });
      });



      const playbtn = document.getElementById("playbtn")


 
      playbtn.onclick = async function () {
          const tabID = "CLIENT_TAB"
        if (opentabs[tabID]) {

              openTAB(tabID);

        } else {

          console.log("play pressed");
          window.server_start_time = Date.now();

            const ASVEX = await Create_vexl(window.GAMEMODEL)

            console.log(ASVEX)

            const sent = await fetch("/api/studio/create_temp_vexl", {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream"
              },
              body: ASVEX
            });

            const ticket_before = await sent.json()

            const ticket = ticket_before["ticket"]

            const newIFRAME = document.createElement("iframe");
            newIFRAME.src = `/client?testing=true&ticket=${ticket}`;

            newIFRAME.style.width = "100%";
            newIFRAME.style.height = "100%";
            newIFRAME.style.border = "none";
            newIFRAME.style.display = "block";


            document.getElementById("DISPLAY3dREAL").appendChild(newIFRAME);

              // IMPORTANT: pass the CLONE, not the original
             const scripttab = createTAB(
                "Client",
                `/exicons/game.svg`,
                newIFRAME,
                false,
                tabID,
              );


          openTAB(tabID);
        }
      };

      // render loop (CRITICAL)
      function animate() {

        requestAnimationFrame(animate);

        updateCameraRotation()
        updateCamera();
 
        stats.begin();

        if (!scene) return;
        renderer.render(window.scene, camera);
        stats.end();
      }

      window.addEventListener("beforeunload", (e) => {
        // Required for Chrome/Edge
         // e.preventDefault();

        // Required for most browsers
       // e.returnValue = "";
      });

      animate();
      updatecam()



      }

