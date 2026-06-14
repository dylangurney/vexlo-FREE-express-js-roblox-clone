const STUD_TO_METER = 0.28;
window.rendersteps = []

class CFrame {
  constructor(position = { x: 0, y: 0, z: 0 }, euler = { x: 0, y: 0, z: 0 }) {
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



async function load_3dstuff() {
  window.PHYSICS_WORLD = null;
  window.ID_TO_BODY = {};
  await RAPIER.init();

  window.PHYSICS_WORLD = new RAPIER.World({
    x: 0,
    y: -9.81,
    z: 0,
  });

  window.scene = new THREE.Scene();

  openState = {}
  selectedNode = null

  window.UpdateOBJ_asrendered = UpdateOBJ_asrendered
  //render game model
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
  const container = document.getElementById("display3darea");
  renderer.setSize(container.clientWidth, container.clientHeight);

  container.appendChild(renderer.domElement);


  const vector = new THREE.Vector3();

  function worldToScreen_core(obj, camera, renderer) {
    const container = renderer.domElement.parentElement;
    const rect = container.getBoundingClientRect();

    vector.setFromMatrixPosition(obj.matrixWorld);
    vector.project(camera);

    return {
      x: (vector.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-vector.y * 0.5 + 0.5) * rect.height + rect.top,
      z: vector.z
    };
  }

  function worldToScreen(ObjectID) {
    let mesh = window.ID_TO_MESH[ObjectID]

    mesh.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.name == "Head") {
          mesh = obj
        }
      }
    });


    return worldToScreen_core(mesh, camera, renderer)
  }

  window.worldToScreen = worldToScreen

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
    if (!(await isDescendantOfWorkspace(id))) {
      const existing2 = window.ID_TO_MESH[id];
      if (existing2) {
        scene.remove(existing2);
        delete window.ID_TO_MESH[id];
      }
      return
    }
    const existing = window.ID_TO_MESH[id];
    const existingBody = window.ID_TO_BODY[id];

    const size = PART.Size;
    const pos = PART.Position;
    const rot = PART.Orientation;
    const col = PART.Color;

    let tex = false

    for (const cid of children) {

      if (!GAMEMODEL[cid]) {
        const should_exist = await REQUEST_INSTANCE_REPLICATION_AND_WAIT(cid)
        if (!should_exist) {
          children = children.filter(c => c !== cid);
          continue //child doesnt exist any more remove from children
        }
      }

      const objd = GAMEMODEL[cid]
      if (objd.props["ClassName"] == "Texture") {
        tex = objd.props
      }
    }



    const geometry = new THREE.BoxGeometry(
      size.x * STUD_TO_METER,
      size.y * STUD_TO_METER,
      size.z * STUD_TO_METER
    );

    let topMat;
    let sidematerial;

    const pcolor = new THREE.Color(col.r / 255, col.g / 255, col.b / 255)
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

      const repeatX = (size.x * STUD_TO_METER) * 3.6;
      const repeatZ = (size.z * STUD_TO_METER) * 3.6;

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

    // ✅ USE CFRAME (IMPORTANT PART)
    const cf = PART.CFrame;

    const cframe = new CFrame(cf.position, cf.rotation || cf.euler || { x: 0, y: 0, z: 0 });

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

    if (PART.Anchored) {
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(cframe.matrix);
    } else {
      mesh.matrixAutoUpdate = true;
    }

    const existingAGAIN = window.ID_TO_MESH[id];
    if (existingAGAIN) {
      scene.remove(existingAGAIN);
      delete window.ID_TO_MESH[id];
    }

    window.ID_TO_MESH[id] = mesh;
    window.scene.add(mesh);
    //physics


    const isAnchored = PART.Anchored === true;

    const rigidDesc = isAnchored
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic();

    rigidDesc.setTranslation(
      cframe.position.x * STUD_TO_METER,
      cframe.position.y * STUD_TO_METER,
      cframe.position.z * STUD_TO_METER
    );

    const body = PHYSICS_WORLD.createRigidBody(rigidDesc);

    // rotation
    const quat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(cframe.euler.x),
        THREE.MathUtils.degToRad(cframe.euler.y),
        THREE.MathUtils.degToRad(cframe.euler.z),
        "YXZ"
      )
    );

    body.setRotation({
      x: quat.x,
      y: quat.y,
      z: quat.z,
      w: quat.w
    }, true);

    // collider
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      (size.x * STUD_TO_METER) / 2,
      (size.y * STUD_TO_METER) / 2,
      (size.z * STUD_TO_METER) / 2
    );

    PHYSICS_WORLD.createCollider(colliderDesc, body);

    window.ID_TO_BODY[id] = body;
  }

  window.add_part_for_render = add_part_for_render

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
    if (!(await isDescendantOfWorkspace(id))) {
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
    const existingBODY = window.ID_TO_BODY[id]
    // 🔥 IF ALREADY RENDERED → JUST UPDATE
    if (rendered && existing && existingBODY) {

        existing.position.set(
          cframe.position.x * STUD_TO_METER,
          cframe.position.y * STUD_TO_METER,
          cframe.position.z * STUD_TO_METER
        );

        existing.rotation.set(
          cframe.euler.x,
          cframe.euler.y,
          cframe.euler.z
        );

        existing.scale.set(scale.x, scale.y, scale.z);

        existingBODY.setTranslation({
          x: cframe.position.x * STUD_TO_METER,
          y: cframe.position.y * STUD_TO_METER,
          z: cframe.position.z * STUD_TO_METER
        }, true);

        const quat = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            THREE.MathUtils.degToRad(cframe.euler.x),
            THREE.MathUtils.degToRad(cframe.euler.y),
            THREE.MathUtils.degToRad(cframe.euler.z),
            "YXZ"
          )
        );

        existingBODY.setRotation(quat, true);
      
      

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
        cframe.position.x * STUD_TO_METER,
        cframe.position.y * STUD_TO_METER,
        cframe.position.z * STUD_TO_METER
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


      const existing = window.ID_TO_MESH[id];
      if (existing) {
        scene.remove(existing);
        delete window.ID_TO_MESH[id];
      }




      window.ID_TO_MESH[id] = character;
      scene.add(character);


      //physics

    const isAnchored = PART.Anchored === true;

    const rigidDesc = isAnchored
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic();

    rigidDesc.setTranslation(
      cframe.position.x * STUD_TO_METER,
      cframe.position.y * STUD_TO_METER,
      cframe.position.z * STUD_TO_METER
    );

    const body = PHYSICS_WORLD.createRigidBody(rigidDesc);

    if (classname == "Character") {
      body.setEnabledRotations(false, false, false, true);
    }

    // rotation
    const quat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(cframe.euler.x),
        THREE.MathUtils.degToRad(cframe.euler.y),
        THREE.MathUtils.degToRad(cframe.euler.z),
        "YXZ"
      )
    );

    body.setRotation({
      x: quat.x,
      y: quat.y,
      z: quat.z,
      w: quat.w
    }, true);
    const box = new THREE.Box3().setFromObject(character);

    const size = new THREE.Vector3();
    box.getSize(size);

    // collider
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      (size.x) / 2,
      (size.y) / 2,
      (size.z) / 2
    );

    PHYSICS_WORLD.createCollider(colliderDesc, body);

    window.ID_TO_BODY[id] = body;

    });
  }
  window.add_MESHpart_for_render = add_MESHpart_for_render


  async function add_decal_for_render(DECAL, id, rendered) {
    if (!(await isDescendantOfWorkspace(id))) {
      return
    }
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

  window.add_decal_for_render = add_decal_for_render

  document.addEventListener("mousedown", (e) => {

    const clickedInside = e.target.closest(".nodeselect");

    if (!clickedInside) {
      document.body.classList.remove("pickmode");

      // re-enable all object buttons
      document.querySelectorAll(".propvalueobjectbtn").forEach(btn => {
        btn.disabled = false;
      });
    }
  });




  async function isDescendantOfWorkspace(obj) {
    const workspaceID = await findFirstChild(window.GAME_MODEL_ID, "Workspace")
    let current = obj;

    while (current) {
      if (current === workspaceID) return true;
      current = GAMEMODEL[current].props.Parent;
    }


    return false;
  }

  async function UpdateOBJ_asrendered(id) {
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
      add_decal_for_render(props, id)
      // UpdateOBJ_asrendered(props.Parent)
    } else if (ClassName == "Texture") {
      UpdateOBJ_asrendered(props.Parent)
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




  // prevent context menu (important)
  container.addEventListener("contextmenu", (e) => {
    if (renderer.domElement.style.display != "none") {
      e.preventDefault()
    }


  });


  async function findFirstChild(obj, text) {
    let children = GAMEMODEL[obj]["children"]
    for (const i of children) {
      let cinfo = GAMEMODEL[i]
      if (!cinfo) {
        cinfo = await REQUEST_INSTANCE_REPLICATION_AND_WAIT(i)
      }
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


  async function updateCameraTOGAME() {
    if (!window.CurrentCamera_id || !GAMEMODEL[window.CurrentCamera_id]) {
      const workspace = await findFirstChild(window.GAME_MODEL_ID, "Workspace");

      if (workspace) {
        let cam = await findFirstChild(workspace, "Camera");
        if (cam) {
          window.CurrentCamera_id = cam;
        }
      }

      return;
    }

    const camObj = GAMEMODEL[window.CurrentCamera_id];

    const cf = camObj.props.CFrame;
    const useLOOKAT = camObj.props.UseLookAt

    if (!cf) return;


    if (useLOOKAT) {

      camera.position.set(
        camObj.props.LookFrom.x * STUD_TO_METER,
        camObj.props.LookFrom.y * STUD_TO_METER,
        camObj.props.LookFrom.z * STUD_TO_METER
      );

      camera.lookAt(
        camObj.props.LookAt.x * STUD_TO_METER,
        camObj.props.LookAt.y * STUD_TO_METER,
        camObj.props.LookAt.z * STUD_TO_METER
      );


    } else { //scriptable
      // POSITION
      camera.position.set(
        cf.position.x * STUD_TO_METER,
        cf.position.y * STUD_TO_METER,
        cf.position.z * STUD_TO_METER
      );


      // ROTATION (Euler degrees → radians)
      camera.rotation.set(
        THREE.MathUtils.degToRad(cf.rotation.x),
        THREE.MathUtils.degToRad(cf.rotation.y),
        THREE.MathUtils.degToRad(cf.rotation.z)
      );
    }

  }

  function updateBubbles() {
    for (const bubble of window.activeBubbles) {
      const screen = worldToScreen(bubble.object);

      const x = screen.x;
      const y = screen.y - bubble.offsetY;

      bubble.dom.style.transform =
        `translate(${x}px, ${y}px)`;
    }
  }
const FIXED_STEP = 1 / 60;
let accumulator = 0;
let lastTime = performance.now();

window.updatephysics = function(now) {

  let delta = (now - lastTime) / 1000;
  lastTime = now;

  // clamp huge frame spikes
  delta = Math.min(delta, 0.1);

  accumulator += delta;

  while (accumulator >= FIXED_STEP) {

    PHYSICS_WORLD.step();
    accumulator -= FIXED_STEP;

    for (const id in window.ID_TO_BODY) {

      const obj = GAMEMODEL[id];
      if (!obj) continue;

      const networkowner = obj.props.NetworkOwner;
      if (networkowner !== window.LOCAL_PLAYER) continue;

      const body = window.ID_TO_BODY[id];
      const mesh = window.ID_TO_MESH[id];

      if (!body || !mesh) continue;

      const pos = body.translation();
      const vel = body.linvel();

      mesh.position.set(pos.x, pos.y, pos.z);

      obj.props.Velocity = {
        x: vel.x / STUD_TO_METER,
        y: vel.y / STUD_TO_METER,
        z: vel.z / STUD_TO_METER
      };

      obj.props.CFrame.position = {
        x: pos.x / STUD_TO_METER,
        y: pos.y / STUD_TO_METER,
        z: pos.z / STUD_TO_METER
      };

      mesh.updateMatrix();
    }
  }
};

  // render loop (CRITICAL)
async function animate() {
    const now = performance.now()

    window.updatephysics(now)

    for (const fn of window.rendersteps) {
      await fn(now)
    }
    updateCameraTOGAME()

    


    if (!scene) return;
    renderer.render(window.scene, camera);
    updateBubbles()


    requestAnimationFrame(animate);


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

