package com.andisetiyawan.btcethtracker;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.Toast;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import java.util.concurrent.Executor;

public class MainActivity extends BridgeActivity {
    private static final String PREFS_NAME = "AsetCoinPrefs";
    private static final String KEY_BIOMETRIC_ENABLED = "biometric_enabled";
    private boolean isAuthenticated = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Tampilkan Splash Screen dan tahan agar data aplikasi di bawahnya tidak terlihat
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        registerPlugin(FileSaverPlugin.class);
        registerPlugin(BiometricAuthPlugin.class);
        super.onCreate(savedInstanceState);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean isEnabled = prefs.getBoolean(KEY_BIOMETRIC_ENABLED, false);

        if (isEnabled) {
            // Sembunyikan WebView agar benar-benar tidak ada data yang bocor sebelum auth
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setVisibility(View.INVISIBLE);
            }
            
            // Tahan splash screen sampai isAuthenticated bernilai true
            splashScreen.setKeepOnScreenCondition(() -> !isAuthenticated);
            
            checkBiometricAuth();
        } else {
            isAuthenticated = true;
        }
    }

    private void checkBiometricAuth() {
        BiometricManager biometricManager = BiometricManager.from(this);
        int canAuthenticate = biometricManager.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
        );

        if (canAuthenticate == BiometricManager.BIOMETRIC_SUCCESS || canAuthenticate == BiometricManager.BIOMETRIC_STATUS_UNKNOWN) {
            showBiometricPrompt();
        } else {
            // Perangkat tidak mendukung atau belum disetup, tapi fitur aktif di app.
            // BiometricPrompt dengan DEVICE_CREDENTIAL akan menangani fallback PIN secara otomatis.
            showBiometricPrompt();
        }
    }

    private void showBiometricPrompt() {
        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt biometricPrompt = new BiometricPrompt(MainActivity.this,
                executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                // Jika user membatalkan (tekan tombol back/luar dialog), tutup aplikasi
                if (errorCode == BiometricPrompt.ERROR_USER_CANCELED || 
                    errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    errorCode == BiometricPrompt.ERROR_CANCELED) {
                    finishAffinity();
                } else {
                    Toast.makeText(getApplicationContext(), "Autentikasi error: " + errString, Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                // Auth berhasil: update flag dan munculkan WebView
                isAuthenticated = true;
                runOnUiThread(() -> {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        getBridge().getWebView().setVisibility(View.VISIBLE);
                    }
                });
            }

            @Override
            public void onAuthenticationFailed() {
                super.onAuthenticationFailed();
                // Kegagalan sementara (sidik jari tidak cocok) ditangani otomatis oleh sistem untuk retry
            }
        });

        BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Keamanan Aset Coin")
                .setSubtitle("Gunakan sidik jari atau PIN perangkat untuk masuk")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .setConfirmationRequired(false)
                .build();

        biometricPrompt.authenticate(promptInfo);
    }
}

