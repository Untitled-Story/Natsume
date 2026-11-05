using System;
using System.IO;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

/// Captures engine geometry together with its actual serialized resource identity.
public static class NatsumeBuiltinMeshProbe
{
    [Serializable] public class UV { public int channel; public int dimension; public Vector4[] values; }
    [Serializable] public class Submesh { public int firstIndex; public int indexCount; }
    [Serializable] public class Output {
        public string unityVersion; public string guid; public long fileID; public string name;
        public Vector3[] positions; public Vector3[] normals; public Vector4[] tangents; public Color[] colors;
        public UV[] texcoords; public int[] indices; public Submesh[] submeshes;
    }
    public static void Run()
    {
        var mesh = Resources.GetBuiltinResource<Mesh>("Cube.fbx");
        if (!mesh || !AssetDatabase.TryGetGUIDAndLocalFileIdentifier(mesh, out string guid, out long fileID))
            throw new Exception("Cannot identify engine Cube mesh");
        if (guid != "0000000000000000e000000000000000" || fileID != 10202)
            throw new Exception("Unexpected engine mesh identity: " + guid + "/" + fileID);
        var uvs = new List<UV>();
        for (int channel = 0; channel < 8; channel++) {
            var attribute = (VertexAttribute)((int)VertexAttribute.TexCoord0 + channel);
            if (!mesh.HasVertexAttribute(attribute)) continue;
            var values = new List<Vector4>(); mesh.GetUVs(channel, values);
            uvs.Add(new UV {channel=channel, dimension=mesh.GetVertexAttributeDimension(attribute), values=values.ToArray()});
        }
        var indices = new List<int>(); var submeshes = new List<Submesh>();
        for (int sub = 0; sub < mesh.subMeshCount; sub++) {
            if (mesh.GetTopology(sub) != MeshTopology.Triangles) throw new Exception("Non-triangle engine submesh");
            var triangles = mesh.GetIndices(sub);
            submeshes.Add(new Submesh {firstIndex=indices.Count, indexCount=triangles.Length});
            indices.AddRange(triangles);
        }
        var output = new Output {
            unityVersion=Application.unityVersion, guid=guid, fileID=fileID, name=mesh.name,
            positions=mesh.vertices, normals=mesh.normals, tangents=mesh.tangents, colors=mesh.colors,
            texcoords=uvs.ToArray(), indices=indices.ToArray(), submeshes=submeshes.ToArray()
        };
        string path = Environment.GetEnvironmentVariable("NATSUME_BUILTIN_MESH_OUTPUT");
        if (string.IsNullOrEmpty(path)) throw new Exception("Set NATSUME_BUILTIN_MESH_OUTPUT");
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path, JsonUtility.ToJson(output, true));
        Debug.Log("Captured engine mesh " + guid + "/" + fileID + " to " + path);
    }
}
