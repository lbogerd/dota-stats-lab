package lab.dota.parser;

import com.google.protobuf.ByteString;
import com.google.protobuf.Descriptors;
import com.google.protobuf.Message;

import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class ValueEncoder {
    interface BlobSink { Map<String, Object> store(String fieldPath, byte[] bytes) throws Exception; }

    private ValueEncoder() {}

    static Object encode(Object value, String path, BlobSink blobs) throws Exception {
        if (value == null || value instanceof String || value instanceof Boolean) return value;
        if (value instanceof Number number) {
            if (number instanceof Double d && !Double.isFinite(d)) return d.toString();
            if (number instanceof Float f && !Float.isFinite(f)) return f.toString();
            return number;
        }
        if (value instanceof ByteString bytes) return blobs.store(path, bytes.toByteArray());
        if (value instanceof byte[] bytes) return blobs.store(path, bytes);
        if (value instanceof Descriptors.EnumValueDescriptor e) return e.getName();
        if (value instanceof Enum<?> e) return e.name();
        if (value instanceof Message message) return encodeMessage(message, path, blobs);
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                result.put(key, encode(entry.getValue(), child(path, key), blobs));
            }
            return result;
        }
        if (value instanceof Collection<?> collection) {
            List<Object> result = new ArrayList<>(collection.size());
            int i = 0;
            for (Object element : collection) result.add(encode(element, indexed(path, i++), blobs));
            return result;
        }
        if (value.getClass().isArray()) {
            int length = Array.getLength(value);
            List<Object> result = new ArrayList<>(length);
            for (int i = 0; i < length; i++) result.add(encode(Array.get(value, i), indexed(path, i), blobs));
            return result;
        }
        // Clarity entity decoders also expose small native value objects (for
        // example vectors). Their native class is retained separately as
        // valueType and their stable parser representation is retained here.
        return value.toString();
    }

    static Map<String, Object> encodeMessage(Message message, String path, BlobSink blobs) throws Exception {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<Descriptors.FieldDescriptor, Object> entry : message.getAllFields().entrySet()) {
            String name = entry.getKey().getName();
            result.put(name, encode(entry.getValue(), child(path, name), blobs));
        }
        return result;
    }

    static String valueType(Object value) {
        if (value == null) return "null";
        if (value instanceof Descriptors.EnumValueDescriptor e) return e.getType().getFullName();
        if (value instanceof Message m) return m.getDescriptorForType().getFullName();
        return value.getClass().getName();
    }

    static Map<String, Object> inlineBytes(String path, byte[] bytes) {
        return Map.of("encoding", "base64", "fieldPath", path,
                "valueBase64", Base64.getEncoder().encodeToString(bytes));
    }

    private static String child(String base, String name) { return base.isEmpty() ? name : base + "." + name; }
    private static String indexed(String base, int index) { return base + "[" + index + "]"; }
}
