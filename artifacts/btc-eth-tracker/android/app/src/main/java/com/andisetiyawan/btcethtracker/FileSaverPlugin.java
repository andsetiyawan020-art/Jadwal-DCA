package com.andisetiyawan.btcethtracker;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * FileSaverPlugin — custom Capacitor plugin yang membuka Android Storage Access
 * Framework (ACTION_CREATE_DOCUMENT) agar pengguna bisa memilih sendiri lokasi
 * penyimpanan file JSON, tanpa melalui Share sheet.
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {

    @PluginMethod
    public void saveFile(PluginCall call) {
        String filename = call.getString("filename", "export.json");

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, filename);

        startActivityForResult(call, intent, "filePickerResult");
    }

    @ActivityCallback
    private void filePickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() == Activity.RESULT_OK) {
            Intent data = result.getData();
            if (data != null && data.getData() != null) {
                Uri uri = data.getData();
                String content = call.getString("content", "");
                try {
                    OutputStream out = getContext().getContentResolver().openOutputStream(uri);
                    if (out != null) {
                        out.write(content.getBytes("UTF-8"));
                        out.close();
                        call.resolve();
                    } else {
                        call.reject("Cannot open output stream for URI");
                    }
                } catch (Exception e) {
                    call.reject("Write failed: " + e.getMessage());
                }
            } else {
                call.reject("No URI returned from file picker");
            }
        } else {
            // User menekan Back / batal — bukan error
            call.reject("cancelled");
        }
    }
}
