import YAML from "js-yaml";

import { Grid } from "./models.js";
import { Player } from "./models.js";
import { Plant } from "./models.js";
import { yamlString } from "./scenarios.js";

import Renderer from "./Renderer.js";
import { GridView, PlantViews, PlayerView } from "./MeshManagers.js";

import "./style.css";

import * as lang from "./languageSelector.js";
import translations from "./translations.json" with { type: "json" };

// Game Initialization
let width;
let height;
const availablePlants = [];
let plantsRequirement = { plants: 0, time: 0 };
const specialEvents = [];
const plantsOnGrid = new Map();
let currentLanguage;


// On game startup or app initialization
document.addEventListener("DOMContentLoaded", () => {
  // Step 1: Dynamically create the language dropdown container
  const dropdownContainer = document.createElement("div");
  dropdownContainer.className = "language-dropdown"; // Add container class for styling

  // Step 2: Append the container to the desired location
  // Example: Append to a header, if it exists
  const TopLeftContainer = document.createElement("topLeftScreen"); // Custom tag
  document.body.appendChild(TopLeftContainer);

  TopLeftContainer.appendChild(dropdownContainer);

  // Step 3: Initialize the dropdown with the dynamically created container
  lang.initLanguageSelector(dropdownContainer);

  // Step 4: Optionally log the saved language or apply translations
  currentLanguage = lang.getSavedLanguage();
  console.log(currentLanguage);
});
currentLanguage = lang.getSavedLanguage();

function scenarioLoader(scenario) {
  width = scenario.grid_size[0];
  height = scenario.grid_size[1];

  for (let plantName of scenario.available_plants) {
    if (Plant.getTypeNames().find((typeName) => typeName == plantName)) {
      availablePlants.push(plantName);
    } else {
      throw new Error("Invalid Scenario: Plant unrecognized");
    }
  }

  plantsRequirement = scenario.win_conditions[0];

  if (scenario.special_events) {
    for (let event of scenario.special_events) {
      specialEvents.push(event);
    }
  }
}

function checkSpecialEvents(currentDay) {
  const currentEvents = specialEvents.filter((event) =>
    event.day == currentDay
  );
  for (const event of currentEvents) {
    confirm(lang.localize(event.description, currentLanguage, translations));
    console.log(event.effects);
    applySpecialEvent(event.effects);
  }
}

function applySpecialEvent(effects) {
  for (const effect of effects) {
    switch (effect[0]) {
      case "sun":
        grid.increaseSunRange(effect[1]);
        grid.setGridValue("sun", effect[1]);
        break;
      case "water":
        grid.setGridValue("water", effect[1]);
        break;
    }
  }
}

const config = YAML.load(yamlString);
scenarioLoader(config.storm);
console.log(specialEvents);

const grid = new Grid(width, height);
const playerCharacter = new Player(0, 0, width, height);

const undoStack = [];
const redoStack = [];

let currentPlantType = availablePlants[0];
let currentDay = 1;
let adultsHarvested = 0;

// Game Functions (Updated to work with THREE.js)
function createMoveCommand(player, dx, dy) {
  const data = { before_dx: 0, before_dy: 0 };
  if (player.boundsCheck(dx, dy)) {
    return {
      execute() {
        player.move(dx, dy);
        data.before_dx = -dx;
        data.before_dy = -dy;
      },
      undo() {
        player.move(data.before_dx, data.before_dy);
      },
    };
  }
  return null;
}

function createTurnCommand(grid) {
  const data = {
    before_grid: grid.serialize(),
    after_grid: "",
    growthMap: new Map(),
  };
  return {
    execute() {
      if (!data.after_grid) {
        grid.randomize();
        checkSpecialEvents(currentDay);
        data.after_grid = grid.serialize();
      } else {
        grid.deserialize(data.after_grid);
      }
      for (const [key, plant] of plantsOnGrid) {
        data.growthMap.set(key, plant.growthStage);
        plant.grow(
          grid.getSunAt(plant.x, plant.y),
          grid.getWaterAt(plant.x, plant.y),
          plantsOnGrid,
        );
      }
      currentDay++;
      notify("dayChanged");
    },
    undo() {
      grid.deserialize(data.before_grid);
      for (const [key, plant] of plantsOnGrid) {
        plant.growthStage = data.growthMap.get(key);
      }
      currentDay--;
      notify("dayChanged");
    },
  };
}

function createSowCommand(x, y) {
  const data = { plant: new Plant(currentPlantType, x, y, 0) };
  return {
    execute() {
      plantsOnGrid.set(`${x}${y}`, data.plant);
      grid.sowCell(x, y);
    },
    undo() {
      plantsOnGrid.delete(`${x}${y}`);
      grid.sowCell(x, y);
    },
  };
}

function createReapCommand(x, y) {
  const data = { plant: plantsOnGrid.get(`${x}${y}`) };
  return {
    execute() {
      plantsOnGrid.delete(`${x}${y}`);
      if (data.plant.growthStage == 3) {
        adultsHarvested++;
      }
      grid.sowCell(x, y);
    },
    undo() {
      plantsOnGrid.set(`${x}${y}`, data.plant);
      if (data.plant.growthStage == 3) {
        adultsHarvested--;
      }
      grid.sowCell(x, y);
    },
  };
}

function handleKeyboardInput(key) {
  redoStack.splice(0, redoStack.length);
  const inputMap = {
    "ArrowLeft": createMoveCommand(playerCharacter, -1, 0),
    "ArrowRight": createMoveCommand(playerCharacter, 1, 0),
    "ArrowUp": createMoveCommand(playerCharacter, 0, -1),
    "ArrowDown": createMoveCommand(playerCharacter, 0, 1),
    "Enter": createTurnCommand(grid),
  };
  const command = inputMap[key];
  manageCommand(command);
}

function farmTheLand(x, y) {
  redoStack.splice(0, redoStack.length);
  if (playerCharacter.isAdjacent(x, y)) {
    if (!grid.readCell(x, y).sowed) {
      manageCommand(createSowCommand(x, y));
    } else {
      manageCommand(createReapCommand(x, y));
    }
  }
}

function manageCommand(command) {
  if (command) {
    undoStack.push(command);
    command.execute();
    notify("scene-changed");
  }
}

function Undo() {
  if (undoStack.length > 0) {
    const command = undoStack.pop();
    command.undo();
    redoStack.push(command);
    notify("scene-changed");
  }
}

function Redo() {
  if (redoStack.length > 0) {
    const command = redoStack.pop();
    command.execute();
    undoStack.push(command);
    notify("scene-changed");
  }
}


function createSave(key) {
  if (!key || key.trim() === "") {
    console.error("Input cannot be empty");
    alert("Input cannot be empty");
    return;
  }
  if (/[^a-zA-Z0-9-_]/.test(key)) {
    alert("Invalid characters dectected");
    return;
  }
  const saveFile = {
    playerPos: { x: playerCharacter.x, y: playerCharacter.y },
    gridState: grid.serialize(),
    plantMap: Array.from(plantsOnGrid.entries()),
    gameState: { currentDay, adultsHarvested },
  };
  const saveData = JSON.stringify(saveFile);
  localStorage.setItem(key, saveData);
  console.log(`Game saved under '${key}'`);
}

function copyDataFromFile(saveFile) {
  playerCharacter.x = saveFile.playerPos.x;
  playerCharacter.y = saveFile.playerPos.y;

  grid.deserialize(saveFile.gridState);

  plantsOnGrid.clear();
  saveFile.plantMap.forEach((plant) => {
    const newPlant = Plant.plantCopy(plant[1]);
    plantsOnGrid.set(plant[0], newPlant);
  });

  currentDay = saveFile.gameState.currentDay;
  adultsHarvested = saveFile.gameState.adultsHarvested;
}

function listSaves() {
  console.log("Saves found:");
  for (let i = 0, len = localStorage.length; i < len; i++) {
    console.log(localStorage.key(i));
  }
}


function loadSave(key) {
  if (!key || key.trim() === "") {
    alert("Please enter a valid save name");
    return;
  }

  const saveData = localStorage.getItem(key);
  if (!saveData) {
    alert(`No save file found within the name '${key}'.`);
    return;
  }

  const saveFile = JSON.parse(saveData);
  undoStack.splice(0, undoStack.length);
  redoStack.splice(0, redoStack.length);

  copyDataFromFile(saveFile);
  notify("scene-changed");
  console.log(`Game loaded from save '${key}'.`)
}


function autosavePrompt() {
  if (localStorage.getItem("autosave")) {
    if (
      confirm(
        lang.localize(
          "Autosave_Continue_prompt",
          currentLanguage,
          translations,
        ),
      )
    ) {
      loadSave("autosave");
    } else {
      localStorage.removeItem("autosave");
    }
  }
}

function checkScenarioWin() {
  const win = adultsHarvested >= plantsRequirement.plants &&
    currentDay <= plantsRequirement.time;
  const lose = currentDay > plantsRequirement.time;
  console.log(plantsRequirement.time);

  if (win) {
    notify("win");
  } else if (lose) {
    console.log("win");
    notify("lose");
  }
}

function notify(name) {
  window.dispatchEvent(new Event(name));
}

// THREE.js Setup
const renderer = new Renderer();
renderer.bindResizeEvent();
renderer.setCameraPosition(0, height, 5);

// Grid Rendering

const gridMeshManager = new GridView(width, height);
gridMeshManager.createGrid();
renderer.addToScene(gridMeshManager.getGrid());
renderer.lookAt(gridMeshManager.getPosition());

// Player Rendering
const playerMeshManager = new PlayerView(0, 0);
renderer.addToScene(playerMeshManager.getPlayerMesh());

// Helper Functions

const plantMeshManager = new PlantViews(renderer.scene);

renderer.onClick((intersect) => {
  const point = intersect.point;
  const gridX = Math.round(point.x);
  const gridY = Math.round(point.z);

  console.log(`Clicked Grid Tile: (${gridX}, ${gridY})`);

  farmTheLand(gridX, gridY);
});

// Raycast on hover
renderer.onHover((intersect) => {
  const point = intersect.point;
  const gridX = Math.round(point.x);
  const gridY = Math.round(point.z);

  updateHoveredTileInfo(gridX, gridY);
});

function updateHoveredTileInfo(x, y) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    hoverInfoContainer.textContent = "";
    return;
  }

  const cellCoords = lang.handleLangR2L(
    lang.localize("Current_Cell", currentLanguage, translations),
    `(${x}, ${y})`,
    currentLanguage
  );
  const sunLevel = lang.handleLangR2L(
    lang.localize("Sun", currentLanguage, translations),
    `${grid.getSunAt(x, y)}`,
    currentLanguage
  );
  const waterLevel = lang.handleLangR2L(
    lang.localize("Water", currentLanguage, translations),
    `${grid.getWaterAt(x, y)}`,
    currentLanguage
  );
  const cellDesc = `${cellCoords} <br>${sunLevel} <br>${waterLevel}`;

  hoverInfoContainer.innerHTML = cellDesc;
}
// Event Listeners
window.addEventListener("keydown", (e) => {
  handleKeyboardInput(e.key);
});

function updatePlayerPosition(x, y) {
  playerMeshManager.updatePosition(x, y);
  renderer.setCameraPosition(x, height, y + 5);
}

// USE THIS FOR SCENE CHANGES
window.addEventListener("scene-changed", () => {
  plantMeshManager.updateMeshes(plantsOnGrid, renderer);
  updatePlayerPosition(playerCharacter.x, playerCharacter.y);
  checkScenarioWin();
  createSave("autosave");
  notify("dayChanged");
});

window.addEventListener("win", () => {
  const message = lang.localize("win_message", currentLanguage, translations);
  if (confirm(message)) {
    window.location.reload();
  }
});

window.addEventListener("lose", () => {
  const message = lang.localize("lose_message", currentLanguage, translations);
  if (confirm(message)) {
    window.location.reload();
  }
});

// Animation Loop
function animate() {
  renderer.render();
  requestAnimationFrame(() => animate());
}

animate();

const PlantContainer = document.createElement("div");
document.body.appendChild(PlantContainer);

//resusable button logic
function gameButtons({ label, callback, container, localize = false }) {
  const button = document.createElement("button");

  if (localize) {
    let key = label;
    key += "_button";
    button.textContent = lang.localize(key, currentLanguage, translations);
  } else {
    button.textContent = label;
  }

  button.addEventListener("click", callback);
  container.appendChild(button);

  return button;
}

// Plant Buttons
for (const key of availablePlants) {
  const icon = Plant.getIcon(key);
  const localizedLabel = lang.localize(`${key}_button`, currentLanguage, translations);

  // Adjusts it so the emoji is on the right for Arabic as its a RTL language
  const isRTL = currentLanguage === "arab";
  const label = isRTL ? `${localizedLabel} ${icon}` : `${icon} ${localizedLabel}`;

  gameButtons({
    label,
    callback: () => {
      currentPlantType = key.toLowerCase();
      console.log(`Selected: ${key}`);
    },
    container: PlantContainer,
  });
}


//Progress Buttons
const undo = document.createElement("button");
undo.textContent = lang.localize("Undo_msg", currentLanguage, translations);
undo.addEventListener("click", () => {
  Undo();
});
PlantContainer.appendChild(undo);

const redo = document.createElement("button");
redo.textContent = lang.localize("Redo_msg", currentLanguage, translations);
redo.addEventListener("click", Redo);
PlantContainer.appendChild(redo);

const save = document.createElement("button");
save.textContent = lang.localize("Save_msg", currentLanguage, translations);
save.addEventListener("click", () => {
  const key = prompt(lang.localize("save_prompt", currentLanguage, translations));
  createSave(key);
});
PlantContainer.appendChild(save);

const load = document.createElement("button");
load.textContent = lang.localize("Load_msg", currentLanguage, translations);
load.addEventListener("click", () => {
  listSaves();
  const key = prompt(
    lang.localize("save_prompt", currentLanguage, translations),
  );
  loadSave(key);
});
PlantContainer.appendChild(load);

//command buttons 
const CommandContainer = document.createElement("div2");
document.body.appendChild(CommandContainer);

CommandContainer.appendChild(gameButtons({
  label: "⬅️",
  callback: () => handleKeyboardInput("ArrowLeft"),
  container: CommandContainer,
})
);

CommandContainer.appendChild(gameButtons({
  label: "➡️",
  callback: () => handleKeyboardInput("ArrowRight"),
  container: CommandContainer,
})
);

CommandContainer.appendChild(gameButtons({
  label: "⬆️",
  callback: () => handleKeyboardInput("ArrowUp"),
  container: CommandContainer,
})
);

CommandContainer.appendChild(gameButtons({
  label: "⬇️",
  callback: () => handleKeyboardInput("ArrowDown"),
  container: CommandContainer,
})
);

CommandContainer.appendChild(
  gameButtons({
    label: lang.localize("Next_Day", currentLanguage, translations),
    callback: () => handleKeyboardInput("Enter"),
    container: CommandContainer,
  })
);


// Add a new container for game state info
const GameStateInfoContainer = document.createElement("topRightScreen"); // Custom tag
document.body.appendChild(GameStateInfoContainer);

function drawDayCounter() {
  // Add text to the container
  const dayCounterText = document.createElement("p"); // Use paragraph tag for text
  function update() {
    const currentDayMsg = lang.localize(
      "Current_Day",
      currentLanguage,
      translations,
    ); // the non-dynamic part of the message to be displayed
    const finalMsg = lang.handleLangR2L(currentDayMsg, currentDay, currentLanguage); // handles final output of message for right-to-left languages
    dayCounterText.textContent = finalMsg; // Set final static text
  }
  update();

  // Apply custom styling
  dayCounterText.classList.add("top-right-text"); // Add CSS class

  // Add a listener for the dayChanged event
  window.addEventListener("dayChanged", update);

  return dayCounterText;
}

GameStateInfoContainer.appendChild(drawDayCounter());

const hoverInfoContainer = document.createElement("p");
hoverInfoContainer.className = "hover-info"; // Style this in your CSS
GameStateInfoContainer.appendChild(hoverInfoContainer);

// Update tile info at the start of the game
updateHoveredTileInfo(playerCharacter.x, playerCharacter.y);
// Update tile info whenever the day changes.
window.addEventListener("dayChanged", () => {
  updateHoveredTileInfo(playerCharacter.x, playerCharacter.y);
});

autosavePrompt();
