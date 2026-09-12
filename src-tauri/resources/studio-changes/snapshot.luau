-- Read-only snapshots of the editable DataModel. No instances or attributes are added.
-- ReflectionService includes inherited properties; inaccessible members are omitted.
local HttpService = game:GetService("HttpService")
local ReflectionService = game:GetService("ReflectionService")
local RunService = game:GetService("RunService")
assert(not RunService:IsRunning(), "Changes capture is unavailable during a playtest")
local key = "__BloxBotChangesV1"
local state = shared[key]
if not state then
    state = { scope = HttpService:GenerateGUID(false), ids = setmetatable({}, { __mode = "k" }), nextId = 0 }
    shared[key] = state
end
local function identity(instance)
    if not state.ids[instance] then
        state.nextId += 1
        state.ids[instance] = tostring(state.nextId)
    end
    return state.ids[instance]
end
local function pathOf(instance)
    local parts = {}
    while instance and instance ~= game do
        table.insert(parts, 1, (instance.Name:gsub("%%", "%%25"):gsub("/", "%%2F")))
        instance = instance.Parent
    end
    return "game/" .. table.concat(parts, "/")
end
local function valueOf(value)
    local kind = typeof(value)
    if kind == "nil" then return "nil" end
    if kind == "number" then
        return if value == value and math.abs(value) ~= math.huge then value else tostring(value)
    end
    if kind == "boolean" or kind == "string" then return value end
    if kind == "Instance" then return pathOf(value) end
    return kind .. "(" .. tostring(value) .. ")"
end
local ignored = { Parent = true, Source = true, Name = true, ClassName = true,
    AssemblyLinearVelocity = true, AssemblyAngularVelocity = true, Velocity = true, RotVelocity = true,
    TimePosition = true, PlaybackLoudness = true }
local function snapshot()
    local objects, classes = {}, {}
    local count = 0
    local function capture(instance)
        count += 1
        assert(count <= 30000, "Place exceeds the 30,000 instance capture limit")
        local className = instance.ClassName
        if not classes[className] then
            classes[className] = ReflectionService:GetPropertiesOfClass(className)
        end
        local properties = {}
        for _, member in classes[className] do
            -- Read-only/runtime properties cannot represent authored edits.
            if not ignored[member.Name] and member.Permits and member.Permits.Write then
                local ok, value = pcall(function() return instance[member.Name] end)
                if ok then properties[member.Name] = valueOf(value) end
            end
        end
        for name, value in instance:GetAttributes() do properties["Attribute: " .. name] = valueOf(value) end
        local tags = instance:GetTags()
        table.sort(tags)
        properties.Tags = table.concat(tags, ", ")
        local object = { id = identity(instance), path = pathOf(instance), className = className, properties = properties }
        if instance:IsA("LuaSourceContainer") then
            local ok, source = pcall(function() return game:GetService("ScriptEditorService"):GetEditorSource(instance) end)
            if not ok then source = instance.Source end
            object.source = source
        end
        objects[object.id] = object
    end
    for _, name in { "Workspace", "ReplicatedStorage", "ReplicatedFirst", "ServerScriptService", "ServerStorage",
        "StarterGui", "StarterPack", "StarterPlayer", "Lighting", "SoundService", "Teams", "MaterialService", "TextChatService" } do
        local root = game:FindFirstChild(name)
        if root then
            capture(root)
            for _, instance in root:GetDescendants() do
                if not instance:IsA("Camera") then capture(instance) end
            end
        end
    end
    return objects
end
local function equal(a, b)
    if typeof(a) ~= typeof(b) then return false end
    if typeof(a) ~= "table" then return a == b end
    for k, v in a do if not equal(v, b[k]) then return false end end
    for k in b do if a[k] == nil then return false end end
    return true
end
local token = __TOKEN__
local action = __ACTION__
if action == "begin" then
    -- Only one tool is in flight in the proxy. Drop leftovers from interrupted calls.
    state.pending = { token = token, before = snapshot() }
    print("BLOXBOT_CAPTURE_JSON" .. HttpService:JSONEncode({ scope = state.scope }))
elseif action == "finish" then
    local pending = state.pending
    assert(pending and pending.token == token, "Studio capture baseline was lost or the active Studio changed")
    local after = snapshot()
    local changes = {}
    for id, before in pending.before do
        if not equal(before, after[id]) then table.insert(changes, { id = id, before = before, after = after[id] }) end
    end
    for id, object in after do
        if not pending.before[id] then table.insert(changes, { id = id, after = object }) end
    end
    local encoded = HttpService:JSONEncode({ version = 1, scope = state.scope, changes = changes })
    assert(#encoded <= 32 * 1024 * 1024, "Changes exceed the 32 MB capture limit")
    state.pending = { token = token, encoded = encoded }
    print("BLOXBOT_CAPTURE_JSON" .. HttpService:JSONEncode({ length = #encoded }))
end
