type TerrainShaderType = 'height_blend' | 'slope_blend' | 'triplanar' | 'full';

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parseHeightLevels(value: string): [number, number, number, number] {
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const nums = parts.map((p) => Number.parseFloat(p)).filter(Number.isFinite);
  const h0 = clampNumber(nums[0] ?? 0.0, 0, 1);
  const h1 = clampNumber(nums[1] ?? 0.3, 0, 1);
  const h2 = clampNumber(nums[2] ?? 0.6, 0, 1);
  const h3 = clampNumber(nums[3] ?? 1.0, 0, 1);
  return [h0, h1, h2, h3];
}

function generateHeightBlendShader(options: {
  textureScale: number;
  blendSharpness: number;
  heightLevels: string;
}): string {
  const [h0, h1, h2, h3] = parseHeightLevels(options.heightLevels);
  const textureScale = clampNumber(options.textureScale, 0.01, 1.0);
  const blendSharpness = clampNumber(options.blendSharpness, 0.1, 10.0);

  return [
    'shader_type spatial;',
    'render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;',
    '',
    '// Texture layers (assign in material)',
    'uniform sampler2D texture_grass : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_dirt : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_rock : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_snow : source_color, filter_linear_mipmap, repeat_enable;',
    '',
    '// Normal maps (optional)',
    'uniform sampler2D normal_grass : hint_normal, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D normal_rock : hint_normal, filter_linear_mipmap, repeat_enable;',
    '',
    '// Parameters',
    `uniform float texture_scale : hint_range(0.01, 1.0) = ${textureScale};`,
    `uniform float blend_sharpness : hint_range(0.1, 10.0) = ${blendSharpness};`,
    `uniform float height_grass : hint_range(0.0, 1.0) = ${h0};`,
    `uniform float height_dirt : hint_range(0.0, 1.0) = ${h1};`,
    `uniform float height_rock : hint_range(0.0, 1.0) = ${h2};`,
    `uniform float height_snow : hint_range(0.0, 1.0) = ${h3};`,
    'uniform float max_terrain_height = 10.0;',
    '',
    '// PBR',
    'uniform float roughness_base : hint_range(0.0, 1.0) = 0.8;',
    'uniform float metallic_base : hint_range(0.0, 1.0) = 0.0;',
    '',
    'varying float vertex_height;',
    '',
    'void vertex() {',
    '    vertex_height = VERTEX.y / max_terrain_height;',
    '}',
    '',
    'void fragment() {',
    '    vec2 uv_scaled = UV * (1.0 / texture_scale);',
    '    ',
    '    // Sample textures',
    '    vec3 grass = texture(texture_grass, uv_scaled).rgb;',
    '    vec3 dirt = texture(texture_dirt, uv_scaled).rgb;',
    '    vec3 rock = texture(texture_rock, uv_scaled).rgb;',
    '    vec3 snow = texture(texture_snow, uv_scaled).rgb;',
    '    ',
    '    // Height-based blend weights',
    '    float h = clamp(vertex_height, 0.0, 1.0);',
    '    ',
    '    float w_grass = 1.0 - smoothstep(height_grass, height_dirt, h);',
    '    float w_dirt = smoothstep(height_grass, height_dirt, h) * (1.0 - smoothstep(height_dirt, height_rock, h));',
    '    float w_rock = smoothstep(height_dirt, height_rock, h) * (1.0 - smoothstep(height_rock, height_snow, h));',
    '    float w_snow = smoothstep(height_rock, height_snow, h);',
    '    ',
    '    // Sharpen blends',
    '    w_grass = pow(w_grass, blend_sharpness);',
    '    w_dirt = pow(w_dirt, blend_sharpness);',
    '    w_rock = pow(w_rock, blend_sharpness);',
    '    w_snow = pow(w_snow, blend_sharpness);',
    '    ',
    '    // Normalize',
    '    float total = w_grass + w_dirt + w_rock + w_snow + 0.001;',
    '    w_grass /= total;',
    '    w_dirt /= total;',
    '    w_rock /= total;',
    '    w_snow /= total;',
    '    ',
    '    // Final color',
    '    ALBEDO = grass * w_grass + dirt * w_dirt + rock * w_rock + snow * w_snow;',
    '    ',
    '    // Normal blending (simplified)',
    '    vec3 n_grass = texture(normal_grass, uv_scaled).rgb * 2.0 - 1.0;',
    '    vec3 n_rock = texture(normal_rock, uv_scaled).rgb * 2.0 - 1.0;',
    '    NORMAL_MAP = normalize(mix(n_grass, n_rock, w_rock + w_snow) * 0.5 + 0.5);',
    '    ',
    '    ROUGHNESS = roughness_base;',
    '    METALLIC = metallic_base;',
    '}',
    '',
  ].join('\n');
}

function generateSlopeBlendShader(options: {
  textureScale: number;
  blendSharpness: number;
}): string {
  const textureScale = clampNumber(options.textureScale, 0.01, 1.0);
  const blendSharpness = clampNumber(options.blendSharpness, 0.1, 10.0);

  return [
    'shader_type spatial;',
    'render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;',
    '',
    'uniform sampler2D texture_flat : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_steep : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D normal_flat : hint_normal, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D normal_steep : hint_normal, filter_linear_mipmap, repeat_enable;',
    '',
    `uniform float texture_scale : hint_range(0.01, 1.0) = ${textureScale};`,
    'uniform float slope_threshold : hint_range(0.0, 1.0) = 0.5;',
    `uniform float blend_sharpness : hint_range(0.1, 10.0) = ${blendSharpness};`,
    'uniform float roughness_flat : hint_range(0.0, 1.0) = 0.7;',
    'uniform float roughness_steep : hint_range(0.0, 1.0) = 0.9;',
    '',
    'void fragment() {',
    '    vec2 uv_scaled = UV * (1.0 / texture_scale);',
    '    ',
    '    // Calculate slope from world normal',
    '    vec3 world_normal = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);',
    '    float slope = 1.0 - abs(world_normal.y);  // 0 = flat, 1 = vertical',
    '    ',
    '    // Blend factor',
    '    float blend = smoothstep(slope_threshold - 0.1, slope_threshold + 0.1, slope);',
    '    blend = pow(blend, blend_sharpness);',
    '    ',
    '    // Sample textures',
    '    vec3 flat_color = texture(texture_flat, uv_scaled).rgb;',
    '    vec3 steep_color = texture(texture_steep, uv_scaled).rgb;',
    '    ',
    '    ALBEDO = mix(flat_color, steep_color, blend);',
    '    ',
    '    // Normals',
    '    vec3 n_flat = texture(normal_flat, uv_scaled).rgb;',
    '    vec3 n_steep = texture(normal_steep, uv_scaled).rgb;',
    '    NORMAL_MAP = mix(n_flat, n_steep, blend);',
    '    ',
    '    ROUGHNESS = mix(roughness_flat, roughness_steep, blend);',
    '    METALLIC = 0.0;',
    '}',
    '',
  ].join('\n');
}

function generateTriplanarShader(options: { textureScale: number }): string {
  const textureScale = clampNumber(options.textureScale, 0.01, 1.0);

  return [
    'shader_type spatial;',
    'render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;',
    '',
    'uniform sampler2D texture_albedo : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_normal : hint_normal, filter_linear_mipmap, repeat_enable;',
    '',
    `uniform float texture_scale : hint_range(0.01, 1.0) = ${textureScale};`,
    'uniform float blend_sharpness : hint_range(0.1, 10.0) = 2.0;',
    'uniform vec4 albedo_tint : source_color = vec4(1.0);',
    'uniform float roughness : hint_range(0.0, 1.0) = 0.8;',
    '',
    'varying vec3 world_pos;',
    'varying vec3 world_normal;',
    '',
    'void vertex() {',
    '    world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;',
    '    world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);',
    '}',
    '',
    'void fragment() {',
    '    // Triplanar blend weights from world normal',
    '    vec3 blend = abs(world_normal);',
    '    blend = pow(blend, vec3(blend_sharpness));',
    '    blend /= (blend.x + blend.y + blend.z);',
    '    ',
    '    // UV coordinates for each axis',
    '    vec2 uv_x = world_pos.zy * texture_scale;',
    '    vec2 uv_y = world_pos.xz * texture_scale;',
    '    vec2 uv_z = world_pos.xy * texture_scale;',
    '    ',
    '    // Sample textures from 3 projections',
    '    vec3 col_x = texture(texture_albedo, uv_x).rgb;',
    '    vec3 col_y = texture(texture_albedo, uv_y).rgb;',
    '    vec3 col_z = texture(texture_albedo, uv_z).rgb;',
    '    ',
    '    // Blend',
    '    ALBEDO = (col_x * blend.x + col_y * blend.y + col_z * blend.z) * albedo_tint.rgb;',
    '    ',
    '    // Triplanar normals',
    '    vec3 n_x = texture(texture_normal, uv_x).rgb * 2.0 - 1.0;',
    '    vec3 n_y = texture(texture_normal, uv_y).rgb * 2.0 - 1.0;',
    '    vec3 n_z = texture(texture_normal, uv_z).rgb * 2.0 - 1.0;',
    '    ',
    '    // Swizzle normals for correct orientation',
    '    n_x = vec3(n_x.zy, n_x.x);',
    '    n_y = vec3(n_y.x, n_y.z, n_y.y);',
    '    n_z = vec3(n_z.xy, n_z.z);',
    '    ',
    '    vec3 blended_normal = normalize(n_x * blend.x + n_y * blend.y + n_z * blend.z);',
    '    NORMAL_MAP = blended_normal * 0.5 + 0.5;',
    '    ',
    '    ROUGHNESS = roughness;',
    '    METALLIC = 0.0;',
    '}',
    '',
  ].join('\n');
}

function generateFullTerrainShader(options: {
  textureScale: number;
  blendSharpness: number;
  heightLevels: string;
}): string {
  const [h0, h1, h2, h3] = parseHeightLevels(options.heightLevels);
  const textureScale = clampNumber(options.textureScale, 0.01, 1.0);
  const blendSharpness = clampNumber(options.blendSharpness, 0.1, 10.0);

  return [
    'shader_type spatial;',
    'render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;',
    '',
    '// ===== FULL TERRAIN SHADER =====',
    '// Combines: Height blending, Slope blending, Triplanar projection',
    '',
    '// Texture layers',
    'uniform sampler2D texture_grass : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_dirt : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_rock : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_snow : source_color, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D texture_cliff : source_color, filter_linear_mipmap, repeat_enable;',
    '',
    '// Normal maps',
    'uniform sampler2D normal_grass : hint_normal, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D normal_rock : hint_normal, filter_linear_mipmap, repeat_enable;',
    'uniform sampler2D normal_cliff : hint_normal, filter_linear_mipmap, repeat_enable;',
    '',
    '// Height thresholds',
    `uniform float height_grass : hint_range(0.0, 1.0) = ${h0};`,
    `uniform float height_dirt : hint_range(0.0, 1.0) = ${h1};`,
    `uniform float height_rock : hint_range(0.0, 1.0) = ${h2};`,
    `uniform float height_snow : hint_range(0.0, 1.0) = ${h3};`,
    'uniform float max_terrain_height = 20.0;',
    '',
    '// Blending',
    `uniform float texture_scale : hint_range(0.01, 1.0) = ${textureScale};`,
    `uniform float blend_sharpness : hint_range(0.1, 10.0) = ${blendSharpness};`,
    'uniform float slope_threshold : hint_range(0.0, 1.0) = 0.6;',
    'uniform float triplanar_sharpness : hint_range(1.0, 8.0) = 4.0;',
    '',
    '// PBR',
    'uniform float roughness_base : hint_range(0.0, 1.0) = 0.75;',
    'uniform float ao_strength : hint_range(0.0, 1.0) = 0.3;',
    '',
    'varying vec3 world_pos;',
    'varying vec3 world_normal;',
    'varying float vertex_height;',
    '',
    'void vertex() {',
    '    world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;',
    '    world_normal = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);',
    '    vertex_height = VERTEX.y / max_terrain_height;',
    '}',
    '',
    'vec3 triplanar_sample(sampler2D tex, vec3 pos, vec3 blend) {',
    '    vec3 x = texture(tex, pos.zy * texture_scale).rgb;',
    '    vec3 y = texture(tex, pos.xz * texture_scale).rgb;',
    '    vec3 z = texture(tex, pos.xy * texture_scale).rgb;',
    '    return x * blend.x + y * blend.y + z * blend.z;',
    '}',
    '',
    'void fragment() {',
    '    vec2 uv_scaled = UV * (1.0 / texture_scale);',
    '    ',
    '    // ===== TRIPLANAR SETUP =====',
    '    vec3 tri_blend = abs(world_normal);',
    '    tri_blend = pow(tri_blend, vec3(triplanar_sharpness));',
    '    tri_blend /= (tri_blend.x + tri_blend.y + tri_blend.z);',
    '    ',
    '    // ===== SLOPE CALCULATION =====',
    '    float slope = 1.0 - abs(world_normal.y);',
    '    float cliff_blend = smoothstep(slope_threshold - 0.1, slope_threshold + 0.1, slope);',
    '    cliff_blend = pow(cliff_blend, blend_sharpness);',
    '    ',
    '    // ===== HEIGHT BLENDING =====',
    '    float h = clamp(vertex_height, 0.0, 1.0);',
    '    ',
    '    float w_grass = 1.0 - smoothstep(height_grass, height_dirt, h);',
    '    float w_dirt = smoothstep(height_grass, height_dirt, h) * (1.0 - smoothstep(height_dirt, height_rock, h));',
    '    float w_rock = smoothstep(height_dirt, height_rock, h) * (1.0 - smoothstep(height_rock, height_snow, h));',
    '    float w_snow = smoothstep(height_rock, height_snow, h);',
    '    ',
    '    // Sharpen',
    '    w_grass = pow(w_grass, blend_sharpness);',
    '    w_dirt = pow(w_dirt, blend_sharpness);',
    '    w_rock = pow(w_rock, blend_sharpness);',
    '    w_snow = pow(w_snow, blend_sharpness);',
    '    ',
    '    // Normalize',
    '    float total = w_grass + w_dirt + w_rock + w_snow + 0.001;',
    '    w_grass /= total; w_dirt /= total; w_rock /= total; w_snow /= total;',
    '    ',
    '    // ===== SAMPLE TEXTURES =====',
    '    // Flat areas use standard UV, cliffs use triplanar',
    '    vec3 grass = mix(texture(texture_grass, uv_scaled).rgb, triplanar_sample(texture_grass, world_pos, tri_blend), cliff_blend * 0.5);',
    '    vec3 dirt = mix(texture(texture_dirt, uv_scaled).rgb, triplanar_sample(texture_dirt, world_pos, tri_blend), cliff_blend * 0.5);',
    '    vec3 rock = mix(texture(texture_rock, uv_scaled).rgb, triplanar_sample(texture_rock, world_pos, tri_blend), cliff_blend * 0.5);',
    '    vec3 snow = texture(texture_snow, uv_scaled).rgb;',
    '    vec3 cliff = triplanar_sample(texture_cliff, world_pos, tri_blend);',
    '    ',
    '    // Height-based base color',
    '    vec3 height_color = grass * w_grass + dirt * w_dirt + rock * w_rock + snow * w_snow;',
    '    ',
    '    // Blend with cliff texture based on slope',
    '    ALBEDO = mix(height_color, cliff, cliff_blend);',
    '    ',
    '    // ===== NORMALS =====',
    '    vec3 n_base = texture(normal_rock, uv_scaled).rgb * 2.0 - 1.0;',
    '    vec3 n_cliff = triplanar_sample(normal_cliff, world_pos, tri_blend) * 2.0 - 1.0;',
    '    NORMAL_MAP = normalize(mix(n_base, n_cliff, cliff_blend)) * 0.5 + 0.5;',
    '    ',
    '    // ===== PBR OUTPUT =====',
    '    ROUGHNESS = roughness_base + cliff_blend * 0.15;',
    '    METALLIC = 0.0;',
    '    AO = 1.0 - (cliff_blend * ao_strength);',
    '}',
    '',
  ].join('\n');
}

export function generateTerrainShader(options: {
  type: string;
  textureScale: number;
  blendSharpness: number;
  heightLevels: string;
}): string {
  const type = options.type.trim().toLowerCase() as TerrainShaderType;
  if (type === 'height_blend') {
    return generateHeightBlendShader(options);
  }
  if (type === 'slope_blend') {
    return generateSlopeBlendShader(options);
  }
  if (type === 'triplanar') {
    return generateTriplanarShader(options);
  }
  if (type === 'full') {
    return generateFullTerrainShader(options);
  }
  throw new Error(`Unknown terrain material type: ${options.type}`);
}
