
package com.recrutement.userservice.service;

import com.recrutement.userservice.entity.Cv;
import com.recrutement.userservice.entity.Role;
import com.recrutement.userservice.entity.User;
import com.recrutement.userservice.exception.CvNotFoundException;
import com.recrutement.userservice.repository.CvRepository;
import com.recrutement.userservice.repository.UserRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

@Service
public class CvService {

    private static final Logger log =
            LoggerFactory.getLogger(CvService.class);

    private static final long MAX_FILE_SIZE = 5L * 1024 * 1024;

    private final CvRepository cvRepository;
    private final UserRepository userRepository;
    private final CvStorageService storageService;

    public CvService(
            CvRepository cvRepository,
            UserRepository userRepository,
            CvStorageService storageService) {

        this.cvRepository = cvRepository;
        this.userRepository = userRepository;
        this.storageService = storageService;
    }


    @Transactional(rollbackFor = Exception.class)
    public Cv upload(Long userId, MultipartFile file) throws IOException {

        // 1. Vérifier le candidat
        User user = userRepository.findByIdForUpdate(userId)
                .orElseThrow(() ->
                        new IllegalArgumentException("Utilisateur introuvable"));

        if (!Boolean.TRUE.equals(user.getEnabled())) {
            throw new IllegalStateException("Compte désactivé");
        }

        if (user.getRole() != Role.CANDIDATE) {
            throw new IllegalArgumentException(
                    "Seuls les candidats peuvent déposer un CV");
        }

        // 2. Vérifier le fichier
        if (file == null || file.isEmpty()
                || file.getSize() > MAX_FILE_SIZE) {
            throw new IllegalArgumentException(
                    "Le PDF doit être non vide et inférieur ou égal à 5 Mo");
        }

        byte[] content = file.getBytes();

        if (content.length < 5
                || content[0] != '%'
                || content[1] != 'P'
                || content[2] != 'D'
                || content[3] != 'F'
                || content[4] != '-') {
            throw new IllegalArgumentException(
                    "Seuls les fichiers PDF sont autorisés.");
        }

        // 3. Calculer la prochaine version
        List<Cv> existingCvs =
                cvRepository.findByUserIdOrderByVersionDesc(userId);

        int nextVersion = existingCvs.isEmpty()
                ? 1
                : existingCvs.get(0).getVersion() + 1;

        // 4. Générer une clé de stockage unique
        String objectKey = "cvs/" + userId + "/"
                + UUID.randomUUID() + ".pdf";

        // 5. Stocker le PDF dans SeaweedFS
        storageService.upload(objectKey, content);

        // 6. Nettoyer le fichier si la transaction échoue
        try {
            TransactionSynchronizationManager.registerSynchronization(
                    new TransactionSynchronization() {

                        @Override
                        public void afterCompletion(int status) {
                            if (status != STATUS_COMMITTED) {
                                try {
                                    storageService.delete(objectKey);
                                } catch (RuntimeException ex) {
                                    log.error(
                                            "Échec du nettoyage du CV : {}",
                                            objectKey, ex);
                                }
                            }
                        }
                    }
            );
        } catch (RuntimeException ex) {
            try {
                storageService.delete(objectKey);
            } catch (RuntimeException cleanupEx) {
                ex.addSuppressed(cleanupEx);
            }
            throw ex;
        }

        // 7. Archiver l'ancien CV actif
        cvRepository.findByUserIdAndActiveTrue(userId)
                .ifPresent(oldCv -> {
                    oldCv.setActive(false);
                    oldCv.setVisible(false);
                    cvRepository.save(oldCv);
                });

        // 8. Créer le nouveau CV actif
        Cv cv = Cv.builder()
                .user(user)
                .fileName(file.getOriginalFilename() == null
                        ? "cv.pdf"
                        : file.getOriginalFilename())
                .objectKey(objectKey)
                .contentType("application/pdf")
                .fileSize((long) content.length)
                .version(nextVersion)
                .active(true)
                .visible(true)
                .build();

        // 9. Enregistrer dans MySQL
        return cvRepository.save(cv);
    }

    @Transactional
    public Cv activate(Long userId, Long cvId) {

        User user = userRepository.findByIdForUpdate(userId)
                .orElseThrow(() ->
                        new IllegalArgumentException("Utilisateur introuvable"));

        if (!Boolean.TRUE.equals(user.getEnabled())
                || user.getRole() != Role.CANDIDATE) {
            throw new IllegalStateException(
                    "Utilisateur non autorisé");
        }

        Cv selectedCv = cvRepository.findByIdAndUserId(cvId, userId)
                .orElseThrow(() ->
                        new IllegalArgumentException("CV introuvable"));

        // Refuser l'activation d'une version archivée
        if (!Boolean.TRUE.equals(selectedCv.getVisible())) {
            throw new IllegalStateException(
                    "Impossible d'activer une version archivée");
        }

        // Désactiver l'ancien CV actif
        cvRepository.findByUserIdAndActiveTrue(userId)
                .ifPresent(currentCv -> {
                    currentCv.setActive(false);
                    cvRepository.save(currentCv);
                });

        // Activer la version sélectionnée
        selectedCv.setActive(true);

        return cvRepository.save(selectedCv);
    }

    @Transactional(readOnly = true)
    public List<Cv> getVisibleCvs(Long userId) {
        return cvRepository
                .findByUserIdAndVisibleTrueOrderByVersionDesc(userId);
    }



    @Transactional(readOnly = true)
    public byte[] download(Long userId, Long cvId) {

        User user = userRepository.findById(userId)
                .orElseThrow(() ->
                        new IllegalArgumentException("Utilisateur introuvable"));

        if (!Boolean.TRUE.equals(user.getEnabled())
                || user.getRole() != Role.CANDIDATE) {
            throw new IllegalStateException("Utilisateur non autorisé");
        }

        Cv cv = cvRepository.findByIdAndUserId(cvId, userId)
                .orElseThrow(() ->
                        new CvNotFoundException("CV introuvable")   );

        if (!Boolean.TRUE.equals(cv.getVisible())) {
            throw new IllegalStateException(
                    "Impossible de télécharger une version archivée");
        }

        return storageService.download(cv.getObjectKey());
    }

    /**
     * CV d'une candidature (snapshot) : lié à candidateId+cvId, indépendant du CV actif.
     * Autorise une version éventuellement archivée (visible=false) pour l'historique.
     */
    @Transactional(readOnly = true)
    public Cv getCvForApplication(Long candidateId, Long cvId) {
        return cvRepository.findByIdAndUserId(cvId, candidateId)
                .orElseThrow(() -> new CvNotFoundException("CV introuvable"));
    }

    @Transactional(readOnly = true)
    public byte[] downloadForApplication(Long candidateId, Long cvId) {
        Cv cv = getCvForApplication(candidateId, cvId);
        return storageService.download(cv.getObjectKey());
    }

}
